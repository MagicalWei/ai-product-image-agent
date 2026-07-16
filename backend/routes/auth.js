import { Router } from 'express';
import { authenticateSession, optionalSessionAuth } from '../auth/sessionMiddleware.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = Router();

// Lazy pool instance
let pool;
export function setPool(p) {
  pool = p;
}

// ─── POST /sync-keys ──────────────────────────────────────────────────────────
// Mounted at /api/custom-auth/sync-keys
// Accepts generic parameter names (evalKey1/2/3) and maps to internal DB columns.
// Uses Better Auth session authentication.
router.post(
  '/sync-keys',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const { evalKey1, evalKey2, evalKey3, mimoKey, geminiKey, qwenKey, customProxy } = req.body;
    const uid = req.user.uid;

    if (!uid) {
      throw new AppError('缺少用户 UID', 400);
    }

    const key1 = evalKey1 || mimoKey || '';
    const key2 = evalKey2 || geminiKey || '';
    const key3 = evalKey3 || qwenKey || '';

    const result = await pool.query(
      'UPDATE users SET mimo_key = $1, gemini_key = $2, qwen_key = $3, custom_proxy = $4 WHERE uid = $5 RETURNING *',
      [key1, key2, key3, customProxy || '', uid]
    );

    if (result.rowCount === 0) {
      throw new AppError('找不到该用户', 404);
    }

    const { password: _, ...profile } = result.rows[0];
    res.json({ success: true, user: profile });
  })
);

// ─── GET /me ─────────────────────────────────────────────────────────────────
// Returns the currently authenticated user's profile via Better Auth session.
router.get(
  '/me',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const result = await pool.query('SELECT * FROM users WHERE uid = $1', [req.user.uid]);
    if (result.rowCount === 0) {
      throw new AppError('用户不存在', 404);
    }
    const user = result.rows[0];
    const { password: _, ...dbProfile } = user;
    const profile = {
      ...dbProfile,
      remainingCredits: user.remaining_credits,
      membershipType: user.membership_type,
    };
    res.json({ success: true, user: profile });
  })
);

// ─── GET /profile/:uid ────────────────────────────────────────────────────────
router.get(
  '/profile/:uid',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const { uid } = req.params;

    // Users may only fetch their own profile (admins can fetch any)
    if (req.user.uid !== uid && req.user.role !== 'admin') {
      throw new AppError('无权访问该用户资料', 403);
    }

    const result = await pool.query('SELECT * FROM users WHERE uid = $1', [uid]);
    if (result.rowCount === 0) {
      throw new AppError('用户不存在', 404);
    }

    const userRow = result.rows[0];
    const { password: _, ...dbProfile } = userRow;
    const profileUser = {
      ...dbProfile,
      remainingCredits: userRow.remaining_credits,
      membershipType: userRow.membership_type,
    };
    res.json({ success: true, user: profileUser });
  })
);

// Test upgrade helper route (ONLY enabled in test environment, NOT in development)
if (process.env.NODE_ENV === 'test') {
  router.get(
    '/test-verification-code',
    asyncHandler(async (req, res) => {
      const email = String(req.query.email || '').trim().toLowerCase();
      if (!email) throw new AppError('缺少邮箱', 400);
      const result = await pool.query(
        `SELECT code FROM email_verification_codes
         WHERE email = $1 AND used = false AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [email]
      );
      if (result.rowCount === 0) throw new AppError('测试验证码不存在', 404);
      res.json({ success: true, code: result.rows[0].code });
    })
  );

  router.post(
    '/test-upgrade',
    optionalSessionAuth,
    asyncHandler(async (req, res) => {
      const { uid, membershipType, billingCycle, remainingCredits } = req.body;
      const targetUid = uid || (req.user && req.user.uid);
      if (!targetUid) {
        throw new AppError('缺少 UID', 400);
      }
      await pool.query(
        'UPDATE users SET membership_type = $1, billing_cycle = $2, remaining_credits = $3 WHERE uid = $4',
        [membershipType || 'free', billingCycle || 'none', remainingCredits !== undefined ? remainingCredits : 10, targetUid]
      );
      res.json({ success: true });
    })
  );
}

// ─── POST /verify-code ────────────────────────────────────────────────────────
// Custom endpoint to verify 6-digit code stored in email_verification_codes table.
// Used for both email verification on signup and password reset.
router.post(
  '/verify-code',
  asyncHandler(async (req, res) => {
    const { email, code } = req.body;
    if (!email || !code) {
      throw new AppError('缺少邮箱或验证码', 400);
    }

    const result = await pool.query(
      `UPDATE email_verification_codes
       SET used = true
       WHERE email = $1 AND code = $2 AND used = false AND expires_at > NOW()
       RETURNING id, email`,
      [email.toLowerCase(), code]
    );

    if (result.rowCount === 0) {
      throw new AppError('验证码无效或已过期', 400);
    }

    // Mark user email as verified
    await pool.query(
      `UPDATE "users" SET "emailVerified" = true WHERE LOWER("email") = $1`,
      [email.toLowerCase()]
    );

    res.json({ success: true, type: 'verify' });
  })
);

export default router;
