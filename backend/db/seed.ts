/**
 * Database seed script.
 *
 * Usage: node db/seed.js
 *
 * Inserts initial seed data for development and testing.
 * Only runs in non-production environments.
 */

import { fileURLToPath } from 'url';
import path from 'path';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, users, notificationMessages } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    console.error('[Seed] Refusing to run seed in production.');
    process.exit(1);
  }

  console.log('[Seed] Seeding database...');

  try {
    // ─── Admin user ───────────────────────────────────────────────────────────
    const adminEmail = 'admin@example.com';
    const existingAdmin = await db
      .select()
      .from(users)
      .where(eq(users.email, adminEmail))
      .limit(1);

    if (existingAdmin.length === 0) {
      const passwordHash = await bcrypt.hash('admin123', 12);
      await db.insert(users).values({
        email: adminEmail,
        passwordHash,
        role: 'admin',
        membershipType: 'enterprise',
        billingCycle: 'annual',
        remainingCredits: 9999,
      });
      console.log('[Seed] Created admin user: admin@example.com / admin123');
    } else {
      console.log('[Seed] Admin user already exists, skipping.');
    }

    // ─── Test user ────────────────────────────────────────────────────────────
    const testEmail = 'test@example.com';
    const existingTest = await db
      .select()
      .from(users)
      .where(eq(users.email, testEmail))
      .limit(1);

    if (existingTest.length === 0) {
      const passwordHash = await bcrypt.hash('test123', 12);
      await db.insert(users).values({
        email: testEmail,
        passwordHash,
        role: 'user',
        membershipType: 'free',
        billingCycle: 'none',
        remainingCredits: 10,
      });
      console.log('[Seed] Created test user: test@example.com / test123');
    } else {
      console.log('[Seed] Test user already exists, skipping.');
    }

    // ─── Sample notifications ─────────────────────────────────────────────────
    const existingNotifications = await db
      .select()
      .from(notificationMessages)
      .limit(1);

    if (existingNotifications.length === 0) {
      await db.insert(notificationMessages).values([
        {
          type: 'system',
          title: '欢迎使用 AI 商品图生成平台',
          content: '感谢您的注册！上传您的产品图片，AI 将为您自动生成高质量的商品展示图。',
          isRead: false,
        },
        {
          type: 'promotion',
          title: '新用户福利：10 张免费生图额度',
          content: '每位新注册用户将获得 10 张免费商品图生成额度，赶快试试吧！',
          isRead: false,
        },
      ]);
      console.log('[Seed] Created sample notification messages.');
    } else {
      console.log('[Seed] Notifications already exist, skipping.');
    }

    console.log('[Seed] Database seeding complete.');
  } catch (err) {
    console.error('[Seed] Seeding failed:', err);
    process.exit(1);
  }

  process.exit(0);
}

seed();
