import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id").primaryKey(),
  storeResults: integer("store_results", { mode: "boolean" }).notNull().default(false),
  anthropicKeyEnc: text("anthropic_key_enc"),
  anthropicKeyLast4: text("anthropic_key_last4"),
  model: text("model"),
  backend: text("backend"),
  localModel: text("local_model"), // the Ollama tag; `model` stays the cloud one — a name is backend-specific
  checkRegistries: integer("check_registries", { mode: "boolean" }).notNull().default(false), // look every extraction up in the registries
  updatedAt: text("updated_at").notNull(),
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  hash: text("hash").notNull().unique(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
});

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
    status: integer("status").notNull(),
    docType: text("doc_type"),
    verdict: text("verdict"),
    sefach: integer("sefach", { mode: "boolean" }).notNull().default(false),
    mode: text("mode").notNull(), // trial | byok | local
    source: text("source").notNull(), // ui | api
    apiKeyId: text("api_key_id"),
    backend: text("backend"),
    model: text("model"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    tokensCached: integer("tokens_cached").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    costUsd: real("cost_usd"), // priced per usage[] entry at list price; null for ollama or an unpriced model
    errorCode: text("error_code"),
    resultEnc: text("result_enc"),
    registries: text("registries"), // JSON summary of the registries check (sources, kinds, counts — no values); null when no check ran
  },
  (t) => [index("documents_user_created").on(t.userId, t.createdAt), index("documents_user_mode_status").on(t.userId, t.mode, t.status)],
);

export type DocumentRow = typeof documents.$inferInsert;
export type UserSettingsRow = typeof userSettings.$inferSelect;

/** Everyone who has signed in at least once. The first row ever inserted is the admin. */
export const users = sqliteTable("users", {
  userId: text("user_id").primaryKey(),
  role: text("role").notNull().default("user"), // user | admin
  trialUnlimited: integer("trial_unlimited", { mode: "boolean" }).notNull().default(false),
  email: text("email"),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
});

export type UserRow = typeof users.$inferSelect;

/** Invite-only registration (clerk mode): one row per invitation Clerk e-mailed for an admin or the bootstrap. */
export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    clerkInvitationId: text("clerk_invitation_id").notNull(), // replaced when the invitation is sent again
    email: text("email").notNull(), // trimmed, lower-cased
    invitedBy: text("invited_by").notNull(), // an admin's user_id, or "system" for the bootstrap invitation
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(), // created_at + 30 days, Clerk's own expiry
    status: text("status").notNull(), // pending | accepted | revoked — "expired" is computed, never stored
    acceptedUserId: text("accepted_user_id"), // nulled when that user is deleted
    acceptedAt: text("accepted_at"),
  },
  // One open invitation per address. Raw SQL, not a column reference: SQLite refuses a
  // table-qualified column in a partial index's WHERE.
  (t) => [uniqueIndex("invitations_one_pending").on(t.email).where(sql`status = 'pending'`)],
);

export type InvitationRow = typeof invitations.$inferSelect;
