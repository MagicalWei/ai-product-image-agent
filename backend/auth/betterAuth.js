import { betterAuth } from 'better-auth';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import config from '../config.js';

// Create a dedicated pool for Better Auth (it manages its own connections)
const authPool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.DB_SSL === 'false'
    ? false
    : { rejectUnauthorized: config.NODE_ENV === 'production' },
  max: 5, // Smaller pool for auth operations
});

authPool.on('error', (err) => {
  console.error('[BetterAuth Pool] Unexpected error:', err.message);
});

export const auth = betterAuth({
  database: authPool,

  // Base URL for callbacks, redirects, and CSRF
  baseURL: config.FRONTEND_URL + '/api/auth',

  // Reuse existing JWT_SECRET as Better Auth's signing secret
  secret: config.JWT_SECRET,

  emailAndPassword: {
    enabled: true,
    password: {
      // Use bcrypt for hashing (same as old system, 12 rounds)
      hash: (password) => bcrypt.hash(password, 12),
      // Custom verify: support bcrypt ($2b$/$2a$) and Better Auth default scrypt
      verify: async ({ password, hash }) => {
        // Bcrypt hashes start with $2a$ or $2b$
        if (hash.startsWith('$2')) {
          const valid = await bcrypt.compare(password, hash);
          return valid;
        }
        // Not a bcrypt hash — return null to let Better Auth use its default scrypt verify
        return null;
      },
    },
  },

  emailVerification: {
    sendVerificationEmail: async ({ user, url, token }) => {
      // Use existing EmailJS integration to send verification code
      const serviceId = config.EMAILJS_SERVICE_ID;
      const templateId = config.EMAILJS_TEMPLATE_ID;
      const publicKey = config.EMAILJS_PUBLIC_KEY;
      const accessToken = config.EMAILJS_ACCESS_TOKEN;

      const isMockMode = !serviceId || serviceId === 'your_service_id' || !templateId || !publicKey;

      if (isMockMode) {
        console.log(`[BetterAuth] Mock email verification for ${user.email}: code=${token}, url=${url}`);
        return;
      }

      try {
        const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            service_id: serviceId,
            template_id: templateId,
            user_id: publicKey,
            accessToken: accessToken || undefined,
            template_params: {
              email: user.email.toLowerCase(),
              code: token,
            },
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error('[BetterAuth] EmailJS send failed:', errText);
        } else {
          console.log(`[BetterAuth] Verification email sent to ${user.email}`);
        }
      } catch (err) {
        console.error('[BetterAuth] EmailJS error:', err.message);
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

  // Use path-based session cookies (not subdomain)
  session: {
    expiresIn: 7 * 24 * 60 * 60, // 7 days (matches old JWT expiry)
    updateAge: 24 * 60 * 60, // Refresh session if older than 1 day
  },
});

export default auth;
