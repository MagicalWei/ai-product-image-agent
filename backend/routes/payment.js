import { Router } from 'express';
import crypto from 'crypto';
import Stripe from 'stripe';
import config from '../config.js';
import { authenticateSession } from '../auth/sessionMiddleware.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = Router();
if (!config.STRIPE_SECRET_KEY || config.STRIPE_SECRET_KEY === 'sk_test_mock_stripe_key') {
  if (config.NODE_ENV === 'production') {
    console.error('[Payment] FATAL: STRIPE_SECRET_KEY is not configured.');
    process.exit(1);
  } else {
    console.warn('[Payment] STRIPE_SECRET_KEY not set — payment endpoints will respond with 503.');
  }
}

const stripe = config.STRIPE_SECRET_KEY
  ? new Stripe(config.STRIPE_SECRET_KEY)
  : null;

// Middleware to guard payment routes when Stripe is not configured
function requireStripe(req, res, next) {
  if (!stripe) {
    return res.status(503).json({ error: '支付服务暂未配置，请联系管理员。' });
  }
  next();
}

// Apply Stripe guard to all payment routes
router.use(requireStripe);

// Lazy pool reference — injected by server.js at startup
let pool;
export function setPool(p) {
  pool = p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage Log Helper
// ─────────────────────────────────────────────────────────────────────────────

async function writeUsageLog(client, uid, action, creditsDelta, creditsAfter, detail) {
  const id = 'ulog-' + crypto.randomUUID();
  await client.query(
    `INSERT INTO usage_logs (id, uid, action, credits_delta, credits_after, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, uid, action, creditsDelta, creditsAfter, detail || '']
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier plans — aligned with Stripe Price IDs
// ─────────────────────────────────────────────────────────────────────────────

const STRIPE_PRICE_MAP = {
  'price_1TpzA3D0QMxGnKe7zTvcIwvE': { planId: 'wei_studio_base', name: 'Wei Studio Base', credits: 20,  membershipType: 'pro' },
  'price_1TpzR4D0QMxGnKe76kHCv3Fs': { planId: 'wei_studio_plus', name: 'Wei Studio Plus', credits: 60,  membershipType: 'pro' },
  'price_1TpzB0D0QMxGnKe7Tfoq6Nd6': { planId: 'wei_studio_pro',  name: 'Wei Studio Pro',  credits: 300, membershipType: 'enterprise' },
};

// ─── POST /create-order ─────────────────────────────────────────────────────
router.post(
  '/create-order',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const { planId, priceId } = req.body;
    const uid = req.user.uid;
    const email = req.user.email;

    if (!planId) {
      throw new AppError('缺少套餐标识', 400);
    }

    if (!priceId) {
      throw new AppError('缺少价格标识', 400);
    }

    const priceInfo = STRIPE_PRICE_MAP[priceId];
    if (!priceInfo || priceInfo.planId !== planId) {
      throw new AppError('无效的套餐价格标识', 400);
    }

    // 先生成 orderId，确保 metadata 和 DB 用同一个
    const orderId = 'ord-' + crypto.randomUUID();

    const sessionResult = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      mode: 'subscription',
      customer_email: email,
      metadata: {
        uid,
        orderId,
        planId: priceInfo.planId,
        credits: priceInfo.credits.toString(),
        membershipType: priceInfo.membershipType,
      },
      success_url: `${config.FRONTEND_URL}/?payment=success&orderId=${orderId}`,
      cancel_url:  `${config.FRONTEND_URL}/?payment=cancel`,
    });

    const amount = sessionResult.amount_total ? sessionResult.amount_total / 100 : 0;

    // Store pending order with the SAME orderId as in Stripe metadata
    await pool.query(
      `INSERT INTO orders (id, order_no, uid, status, amount, credits, plan_id, stripe_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [orderId, orderId, uid, 'pending', amount, priceInfo.credits, priceInfo.planId, sessionResult.id]
    );

    console.log(`[Payment] Created order ${orderId} for user ${uid}, plan ${priceInfo.planId}, session ${sessionResult.id}`);

    res.json({
      success: true,
      order: {
        orderId,
        planName: priceInfo.name,
        amount,
        status: 'pending',
        checkoutUrl: sessionResult.url,
      },
    });
  })
);

// ─── POST /webhook ──────────────────────────────────────────────────────────
router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      // constructEvent expects raw body as Buffer
      const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody || '');
      event = stripe.webhooks.constructEvent(rawBody, sig, config.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.warn('[Stripe Webhook] Signature verification failed:', err.message);
      return res.status(400).send(`Webhook Signature Error: ${err.message}`);
    }

    console.log(`[Stripe Webhook] Received event: ${event.type}`);

    // ── checkout.session.completed: payment succeeded ──
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { uid, orderId, planId, credits, membershipType } = session.metadata;
      const creditsNum = parseInt(credits) || 0;

      if (!uid || !orderId) {
        console.error('[Stripe Webhook] Missing uid or orderId in session metadata');
        return res.status(400).json({ error: 'Missing metadata' });
      }

      // Idempotency guard: don't process the same order twice
      const existingOrder = await pool.query('SELECT status FROM orders WHERE id = $1', [orderId]);
      if (existingOrder.rows[0]?.status === 'success') {
        console.log(`[Stripe Webhook] Order ${orderId} already processed. Skipping.`);
        return res.json({ received: true });
      }

      console.log(`[Stripe Webhook] Payment verified for Order ${orderId}. Plan: ${planId}, Credits: ${creditsNum}, Membership: ${membershipType}`);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Mark order as paid
        await client.query(
          "UPDATE orders SET status = 'success', amount = $1, paid_at = NOW(), updated_at = NOW() WHERE id = $2",
          [session.amount_total ? session.amount_total / 100 : 0, orderId]
        );

        // 2. Upgrade membership_type + add credits + set billing_cycle
        await client.query(
          `UPDATE users
           SET membership_type = $1,
               billing_cycle = 'monthly',
               remaining_credits = remaining_credits + $2,
               updated_at = NOW()
           WHERE uid = $3`,
          [membershipType || 'pro', creditsNum, uid]
        );

        // 3. Get updated user info for logging
        const userRes = await client.query(
          'SELECT remaining_credits, membership_type FROM users WHERE uid = $1', [uid]
        );
        const afterBalance = userRes.rows[0]?.remaining_credits || 0;
        const currentMembership = userRes.rows[0]?.membership_type || 'free';

        // 4. Write usage log
        await writeUsageLog(
          client, uid, 'purchase', creditsNum, afterBalance,
          `Stripe checkout completed. Order: ${orderId}, Plan: ${planId}, Credits: +${creditsNum}, Membership: ${currentMembership}`
        );

        await client.query('COMMIT');
        console.log(`[Stripe Webhook] ✅ User ${uid}: membership=${currentMembership}, credits=${afterBalance}, plan=${planId}`);
      } catch (dbErr) {
        await client.query('ROLLBACK');
        console.error('[Stripe Webhook] Transaction rolled back:', dbErr);
        throw dbErr;  // let Stripe retry
      } finally {
        client.release();
      }
    }

    // ── checkout.session.expired: payment abandoned ──
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      const { orderId } = session.metadata || {};
      if (orderId) {
        await pool.query(
          "UPDATE orders SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'pending'",
          [orderId]
        );
        console.log(`[Stripe Webhook] Order ${orderId} marked as expired`);
      }
    }

    res.json({ received: true });
  })
);

// ─── GET /order-status/:orderId ─────────────────────────────────────────────
// Frontend polls this after returning from Stripe checkout to confirm activation
router.get(
  ['/order-status/:orderId', '/status/:orderId'],
  authenticateSession,
  asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const uid = req.user.uid;

    const orderRes = await pool.query(
      'SELECT id, order_no, status, credits, plan_id, paid_at FROM orders WHERE id = $1 AND uid = $2',
      [orderId, uid]
    );

    if (orderRes.rowCount === 0) {
      throw new AppError('订单不存在', 404);
    }

    const order = orderRes.rows[0];

    // If paid, also return current user membership info
    if (order.status === 'success') {
      const userRes = await pool.query(
        'SELECT membership_type, remaining_credits FROM users WHERE uid = $1', [uid]
      );
      return res.json({
        success: true,
        order,
        status: order.status,
        membershipType: userRes.rows[0]?.membership_type || 'free',
        remainingCredits: userRes.rows[0]?.remaining_credits || 0,
      });
    }

    res.json({
      success: true,
      order,
      status: order.status
    });
  })
);

// ─── POST /deduct ───────────────────────────────────────────────────────────
// Deduct 1 credit. Returns the new balance. Premium users are not charged.
// External callers: agent.js uses pool directly, but this endpoint is kept
// for API consistency and testing.
router.post(
  '/deduct',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const uid = req.user.uid;

    const userRes = await pool.query('SELECT * FROM users WHERE uid = $1', [uid]);
    if (userRes.rowCount === 0) {
      throw new AppError('用户未登录或不存在', 404);
    }

    const user = userRes.rows[0];
    let remainingCredits = user.remaining_credits;

    if (user.membership_type !== 'pro' && user.membership_type !== 'enterprise') {
      if (remainingCredits <= 0) {
        throw new AppError('信用额度不足，请充值后继续使用', 402);
      }
      remainingCredits -= 1;
      await pool.query('UPDATE users SET remaining_credits = $1, updated_at = NOW() WHERE uid = $2', [remainingCredits, uid]);
      await writeUsageLog(pool, uid, 'deduct', -1, remainingCredits, 'Deduct 1 credit for image generation');
    }

    const isPremium = user.membership_type === 'pro' || user.membership_type === 'enterprise';

    res.json({
      success: true,
      remainingCredits: isPremium ? 'unlimited' : remainingCredits,
      membershipType: user.membership_type,
    });
  })
);

// ─── POST /refund ───────────────────────────────────────────────────────────
// Refund 1 credit (called when image generation fails).
router.post(
  '/refund',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const uid = req.user.uid;
    const { detail } = req.body;

    const userRes = await pool.query('SELECT * FROM users WHERE uid = $1', [uid]);
    if (userRes.rowCount === 0) {
      throw new AppError('用户未登录或不存在', 404);
    }

    const user = userRes.rows[0];
    let remainingCredits = user.remaining_credits;

    if (user.membership_type !== 'pro' && user.membership_type !== 'enterprise') {
      remainingCredits += 1;
      await pool.query('UPDATE users SET remaining_credits = $1, updated_at = NOW() WHERE uid = $2', [remainingCredits, uid]);
      await writeUsageLog(pool, uid, 'refund', 1, remainingCredits, detail || 'Refund 1 credit due to failure');
    }

    res.json({
      success: true,
      remainingCredits,
    });
  })
);

// ─── GET /usage-logs ────────────────────────────────────────────────────────
router.get(
  '/usage-logs',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const uid = req.user.uid;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const result = await pool.query(
      'SELECT id, action, credits_delta, credits_after, detail, created_at FROM usage_logs WHERE uid = $1 ORDER BY created_at DESC LIMIT $2',
      [uid, limit]
    );
    res.json({ success: true, logs: result.rows });
  })
);

// ─── POST /charge ───────────────────────────────────────────────────────────
// Charge credits. agent.js calls this via pool directly but this is the
// public endpoint version for external callers.
router.post(
  '/charge',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const uid = req.user.uid;
    const { detail } = req.body;

    const userRes = await pool.query('SELECT * FROM users WHERE uid = $1', [uid]);
    if (userRes.rowCount === 0) {
      throw new AppError('用户未登录或不存在', 404);
    }

    const user = userRes.rows[0];
    let remainingCredits = user.remaining_credits;

    if (user.membership_type !== 'pro' && user.membership_type !== 'enterprise') {
      if (remainingCredits <= 0) {
        throw new AppError('信用额度不足', 402);
      }
      remainingCredits -= 1;
      await pool.query('UPDATE users SET remaining_credits = $1, updated_at = NOW() WHERE uid = $2', [remainingCredits, uid]);
    }

    await writeUsageLog(pool, uid, 'charge', 0, remainingCredits, detail || 'Charge generation');
    return res.json({
      success: true,
      remainingCredits,
      membershipType: user.membership_type,
    });
  })
);

// ─── POST /refund ───────────────────────────────────────────────────────────
// (duplicate name but we'll use a single endpoint per the API design)

// ─── GET /orders ────────────────────────────────────────────────────────────
router.get(
  '/orders',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      'SELECT id, order_no, status, amount, credits, plan_id, created_at FROM orders WHERE uid = $1 ORDER BY created_at DESC',
      [req.user.uid]
    );
    res.json({ success: true, orders: result.rows });
  })
);

export { STRIPE_PRICE_MAP };
export default router;
