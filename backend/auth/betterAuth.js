import { betterAuth } from 'better-auth';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import config from '../config.js';

// Create a dedicated pool for Better Auth (it manages its own connections)
const authPool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.DB_SSL === 'false'
    ? false
    : { rejectUnauthorized: config.NODE_ENV === 'production' },
  max: 5,
});

authPool.on('error', (err) => {
  console.error('[BetterAuth Pool] Unexpected error:', err.message);
});

// Generate 6-digit verification code
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Send email via EmailJS
async function sendEmailJS(email, code) {
  const serviceId = config.EMAILJS_SERVICE_ID;
  const templateId = config.EMAILJS_TEMPLATE_ID;
  const publicKey = config.EMAILJS_PUBLIC_KEY;
  const accessToken = config.EMAILJS_ACCESS_TOKEN;

  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      accessToken: accessToken || undefined,
      template_params: { email: email.toLowerCase(), code },
    }),
  });
  const text = await response.text();
  if (!response.ok || text !== 'OK') {
    throw new Error(`EmailJS send failed: ${response.status} ${text}`);
  }
}

export const auth = betterAuth({
  database: authPool,

  baseURL: config.FRONTEND_URL + '/api/auth',
  secret: config.JWT_SECRET,

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url, token }) => {
      // Generate short code, store in email_verification_codes table
      const code = generateCode();
      try {
        await authPool.query(
          `INSERT INTO email_verification_codes (id, email, code, expires_at, used, created_at)
           VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes', false, NOW())`,
          [crypto.randomUUID(), user.email.toLowerCase(), code]
        );
        await sendEmailJS(user.email, code);
        console.log(`[BetterAuth] Reset code ${code} sent to ${user.email}`);
      } catch (err) {
        console.error('[BetterAuth] sendResetPassword error:', err.message);
      }
    },
    password: {
      hash: (password) => bcrypt.hash(password, 12),
      verify: async ({ password, hash }) => {
        if (hash.startsWith('$2')) {
          return await bcrypt.compare(password, hash);
        }
        return null;
      },
    },
  },

  emailVerification: {
    // Disable Better Auth's auto-verify mechanism — we handle it ourselves
    // via custom /api/custom-auth routes
    sendVerificationEmail: async ({ user, url, token }) => {
      const code = generateCode();
      try {
        await authPool.query(
          `INSERT INTO email_verification_codes (id, email, code, expires_at, used, created_at)
           VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes', false, NOW())`,
          [crypto.randomUUID(), user.email.toLowerCase(), code]
        );
        await sendEmailJS(user.email, code);
        console.log(`[BetterAuth] Verification code ${code} sent to ${user.email}`);
      } catch (err) {
        console.error('[BetterAuth] sendVerificationEmail error:', err.message);
      }
    },
  },

  user: {
    modelName: 'users',
    additionalFields: {
      role: { type: 'string', defaultValue: 'user' },
      membershipType: { type: 'string', defaultValue: 'free', fieldName: 'membership_type' },
      billingCycle: { type: 'string', defaultValue: 'none', fieldName: 'billing_cycle' },
      remainingCredits: { type: 'number', defaultValue: 10, fieldName: 'remaining_credits' },
      mimoKey: { type: 'string', fieldName: 'mimo_key' },
      geminiKey: { type: 'string', fieldName: 'gemini_key' },
      qwenKey: { type: 'string', fieldName: 'qwen_key' },
      customProxy: { type: 'string', fieldName: 'custom_proxy' },
    },
  },

  trustedOrigins: [config.FRONTEND_URL],

  session: {
    expiresIn: 7 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
});

export default auth;
