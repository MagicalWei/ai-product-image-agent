import { relations } from 'drizzle-orm';
import {
  users,
  emailVerificationCodes,
  brandMemories,
  assets,
  orders,
  doubaoAgentSessions,
} from './schema';

// ─────────────────────────────────────────────────────────────────────────────
// users relations
// ─────────────────────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ one, many }) => ({
  brandMemory: one(brandMemories, {
    fields: [users.uid],
    references: [brandMemories.uid],
  }),
  assets: many(assets),
  orders: many(orders),
  agentSessions: many(doubaoAgentSessions),
}));

// ─────────────────────────────────────────────────────────────────────────────
// brand_memories relations
// ─────────────────────────────────────────────────────────────────────────────
export const brandMemoriesRelations = relations(brandMemories, ({ one }) => ({
  user: one(users, {
    fields: [brandMemories.uid],
    references: [users.uid],
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// assets relations
// ─────────────────────────────────────────────────────────────────────────────
export const assetsRelations = relations(assets, ({ one }) => ({
  user: one(users, {
    fields: [assets.uid],
    references: [users.uid],
  }),
  session: one(doubaoAgentSessions, {
    fields: [assets.sessionId],
    references: [doubaoAgentSessions.sessionId],
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// orders relations
// ─────────────────────────────────────────────────────────────────────────────
export const ordersRelations = relations(orders, ({ one }) => ({
  user: one(users, {
    fields: [orders.uid],
    references: [users.uid],
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// doubao_agent_sessions relations
// ─────────────────────────────────────────────────────────────────────────────
export const doubaoAgentSessionsRelations = relations(doubaoAgentSessions, ({ one, many }) => ({
  user: one(users, {
    fields: [doubaoAgentSessions.uid],
    references: [users.uid],
  }),
  assets: many(assets),
}));
