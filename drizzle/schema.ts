import { index, int, mediumtext, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
// Legacy deployment data retained to avoid a destructive database migration.
// No FMHYchat runtime code reads or writes this table after the OAuth removal.
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const fmhyRateBuckets = mysqlTable("fmhy_rate_buckets", {
  id: int("id").autoincrement().primaryKey(),
  scope: varchar("scope", { length: 16 }).notNull(),
  subjectHash: varchar("subjectHash", { length: 64 }).notNull(),
  windowStartedAt: timestamp("windowStartedAt").notNull(),
  requestCount: int("requestCount").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
}, table => [
  uniqueIndex("fmhy_rate_bucket_scope_subject_window_unique").on(table.scope, table.subjectHash, table.windowStartedAt),
  index("fmhy_rate_bucket_expires_idx").on(table.expiresAt),
]);

export const fmhySearchLeases = mysqlTable("fmhy_search_leases", {
  leaseId: varchar("leaseId", { length: 64 }).primaryKey(),
  status: mysqlEnum("status", ["waiting", "active"]).notNull().default("waiting"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
}, table => [
  index("fmhy_search_lease_expires_idx").on(table.expiresAt),
  index("fmhy_search_lease_status_idx").on(table.status, table.createdAt),
]);

export const fmhySourceCache = mysqlTable("fmhy_source_cache", {
  pageUrl: varchar("pageUrl", { length: 512 }).primaryKey(),
  resourcesJson: mediumtext("resourcesJson"),
  freshUntil: timestamp("freshUntil"),
  refreshLeaseId: varchar("refreshLeaseId", { length: 64 }),
  refreshLeaseUntil: timestamp("refreshLeaseUntil"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  index("fmhy_source_cache_fresh_idx").on(table.freshUntil),
  index("fmhy_source_cache_refresh_idx").on(table.refreshLeaseUntil),
]);

export const fmhyProtectionMetrics = mysqlTable("fmhy_protection_metrics", {
  id: int("id").autoincrement().primaryKey(),
  minuteStartedAt: timestamp("minuteStartedAt").notNull(),
  kind: varchar("kind", { length: 64 }).notNull(),
  count: int("count").notNull(),
}, table => [
  uniqueIndex("fmhy_protection_metric_minute_kind_unique").on(table.minuteStartedAt, table.kind),
  index("fmhy_protection_metric_minute_idx").on(table.minuteStartedAt),
]);

export const fmhyProtectionPolicy = mysqlTable("fmhy_protection_policy", {
  id: int("id").primaryKey(),
  revision: int("revision").notNull(),
  clientRequestsPerMinute: int("clientRequestsPerMinute").notNull(),
  globalSearchesPerMinute: int("globalSearchesPerMinute").notNull(),
  maxConcurrency: int("maxConcurrency").notNull(),
  maxWaitingRequests: int("maxWaitingRequests").notNull(),
  maxQueueWaitMs: int("maxQueueWaitMs").notNull(),
  circuitFailureThreshold: int("circuitFailureThreshold").notNull(),
  circuitCooldownMaxSeconds: int("circuitCooldownMaxSeconds").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const fmhyProtectionCircuit = mysqlTable("fmhy_protection_circuit", {
  provider: varchar("provider", { length: 32 }).primaryKey(),
  failureCount: int("failureCount").notNull(),
  failureWindowStartedAt: timestamp("failureWindowStartedAt"),
  openUntil: timestamp("openUntil"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
