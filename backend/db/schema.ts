import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
  index,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// pgvector type for embeddings (1536-dimensional float32 array)
// Drizzle doesn't have a built-in vector type, so we define it via customType
const vector = (name: string, dim: number = 1536) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dim})`;
    },
  })(name);

// ─────────────────────────────────────────────────────────────────────────────
// This schema is aligned with the production migration:
//   backend/db/migrations/0001_align_schema_with_code.sql
//
// All tables use `uid varchar(64)` (not uuid) to match the actual auth system.
// Do NOT generate migrations from this file unless you also update the SQL
// migration to match.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 1. users — 用户表
// ─────────────────────────────────────────────────────────────────────────────
export const users = pgTable(
  'users',
  {
    uid: varchar('uid', { length: 64 }).primaryKey().notNull(),
    email: varchar('email', { length: 255 }).unique().notNull(),
    password: varchar('password', { length: 255 }).notNull(),
    role: varchar('role', { length: 32 }).notNull().default('user'),
    membershipType: varchar('membership_type', { length: 32 }).notNull().default('free'),
    billingCycle: varchar('billing_cycle', { length: 32 }).notNull().default('none'),
    remainingCredits: integer('remaining_credits').notNull().default(10),
    mimoKey: varchar('mimo_key', { length: 255 }).default(''),
    geminiKey: varchar('gemini_key', { length: 255 }).default(''),
    qwenKey: varchar('qwen_key', { length: 255 }).default(''),
    customProxy: varchar('custom_proxy', { length: 512 }).default(''),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_users_email').on(table.email),
    sql`CONSTRAINT chk_remaining_credits CHECK (remaining_credits >= 0)`,
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. email_verification_codes — 邮箱验证码表
// ─────────────────────────────────────────────────────────────────────────────
export const emailVerificationCodes = pgTable(
  'email_verification_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    code: varchar('code', { length: 6 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    used: boolean('used').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_verification_email').on(table.email, table.used, table.expiresAt),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. doubao_agent_sessions — Agent 会话表
// ─────────────────────────────────────────────────────────────────────────────
export const doubaoAgentSessions = pgTable(
  'doubao_agent_sessions',
  {
    sessionId: varchar('session_id', { length: 128 }).primaryKey().notNull(),
    uid: varchar('uid', { length: 64 })
      .notNull()
      .references(() => users.uid, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull().default('新设计会话'),
    currentState: varchar('current_state', { length: 64 }).notNull().default('COLLECTING_INFO'),
    chatHistory: jsonb('chat_history').notNull().default('[]'),
    lastParams: jsonb('last_params').notNull().default('{}'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    canvasState: jsonb('canvas_state').notNull().default('{}'),
    pendingToolCalls: jsonb('pending_tool_calls').notNull().default('[]'),
    toolResults: jsonb('tool_results').notNull().default('{}'),
    agentMemory: jsonb('agent_memory').notNull().default('{}'),
    productAnalysisDraft: jsonb('product_analysis_draft').notNull().default('{}'),
    productAnalysisConfirmed: jsonb('product_analysis_confirmed').notNull().default('{}'),
  },
  (table) => [
    index('idx_sessions_uid').on(table.uid),
    index('idx_sessions_uid_updated').on(table.uid, table.updatedAt.desc().nullsLast()),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. brand_memories — 品牌记忆表
// ─────────────────────────────────────────────────────────────────────────────
export const brandMemories = pgTable(
  'brand_memories',
  {
    uid: varchar('uid', { length: 64 })
      .primaryKey()
      .notNull()
      .references(() => users.uid, { onDelete: 'cascade' }),
    brandName: varchar('brand_name', { length: 255 }).default(''),
    style: varchar('style', { length: 255 }).default(''),
    colorPalette: jsonb('color_palette').notNull().default('[]'),
    typography: varchar('typography', { length: 255 }).default(''),
    logoUrl: varchar('logo_url', { length: 512 }).default(''),
    productName: varchar('product_name', { length: 255 }).default(''),
    productCategory: varchar('product_category', { length: 255 }).default(''),
    sellingPoints: jsonb('selling_points').notNull().default('[]'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. assets — 素材表
// ─────────────────────────────────────────────────────────────────────────────
export const assets = pgTable(
  'assets',
  {
    id: varchar('id', { length: 128 }).primaryKey().notNull(),
    uid: varchar('uid', { length: 64 })
      .notNull()
      .references(() => users.uid, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    url: varchar('url', { length: 512 }).notNull(),
    size: varchar('size', { length: 32 }).notNull().default('0 KB'),
    date: varchar('date', { length: 16 }).notNull().default(''),
    metrics: jsonb('metrics'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    source: varchar('source', { length: 32 }).notNull().default('user_uploaded'),
    sessionId: varchar('session_id', { length: 128 }),
  },
  (table) => [
    index('idx_assets_uid').on(table.uid),
    index('idx_assets_uid_date').on(table.uid, table.date.desc()),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. orders — 订单表
// ─────────────────────────────────────────────────────────────────────────────
export const orders = pgTable(
  'orders',
  {
    id: varchar('id', { length: 128 }).primaryKey().notNull(),
    uid: varchar('uid', { length: 64 })
      .notNull()
      .references(() => users.uid, { onDelete: 'cascade' }),
    orderNo: varchar('order_no', { length: 64 }).unique().notNull(),
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    credits: integer('credits').notNull(),
    planId: varchar('plan_id', { length: 64 }).notNull(),
    stripeSessionId: varchar('stripe_session_id', { length: 255 }),
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_orders_uid').on(table.uid),
    index('idx_orders_uid_created').on(table.uid, table.createdAt.desc().nullsLast()),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// 7. rag_documents — RAG 知识库向量存储表
// ─────────────────────────────────────────────────────────────────────────────
export const ragDocuments = pgTable(
  'rag_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    content: text('content').notNull(),
    metadata: jsonb('metadata').notNull().default('{}'),
    embedding: vector('embedding'),
    category: varchar('category', { length: 64 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_rag_documents_category').on(table.category),
    // IVFFlat index for vector similarity search is created via SQL migration
    // (Drizzle cannot express USING ivfflat)
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Type exports
// ─────────────────────────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type EmailVerificationCode = typeof emailVerificationCodes.$inferSelect;
export type DoubaoAgentSession = typeof doubaoAgentSessions.$inferSelect;
export type BrandMemory = typeof brandMemories.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type RagDocument = typeof ragDocuments.$inferSelect;
