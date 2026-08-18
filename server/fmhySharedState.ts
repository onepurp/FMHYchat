import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import {
  FMHY_GLOBAL_SEARCH_LIMIT_MAX_REQUESTS,
  FMHY_SEARCH_MAX_CONCURRENCY,
  FMHY_SEARCH_MAX_QUEUE_WAIT_MS,
  FMHY_SEARCH_MAX_WAITING_REQUESTS,
  FMHY_SEARCH_LIMIT_MAX_REQUESTS,
  FMHY_SEARCH_LIMIT_WINDOW_MS,
  FmhyProtectionPolicyInput,
  FmhySharedAdmissionStore,
  FmhySharedRateBucketDecision,
  FmhySharedSearchLeaseDecision,
  validateFmhyProtectionPolicy,
} from "./fmhyProtection";

export const FMHY_SHARED_SEARCH_LEASE_MS = 60_000;
export const FMHY_SHARED_SOURCE_REFRESH_LEASE_MS = 25_000;
const FMHY_SHARED_SEARCH_QUEUE_POLL_MS = 200;

type SqlRow = Record<string, unknown>;

function rowsFromExecute(result: unknown): SqlRow[] {
  if (!Array.isArray(result) || !Array.isArray(result[0])) return [];
  return result[0] as SqlRow[];
}

function dateFromUnknown(value: unknown) {
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function currentWindow(now = new Date()) {
  const start = new Date(Math.floor(now.getTime() / FMHY_SEARCH_LIMIT_WINDOW_MS) * FMHY_SEARCH_LIMIT_WINDOW_MS);
  return { start, expiresAt: new Date(start.getTime() + FMHY_SEARCH_LIMIT_WINDOW_MS) };
}

function retryAfterSeconds(now: Date, expiresAt: Date) {
  return Math.max(1, Math.min(60, Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000)));
}

function waitForSharedSearchSlot() {
  return new Promise(resolve => setTimeout(resolve, FMHY_SHARED_SEARCH_QUEUE_POLL_MS));
}

async function requireSharedDatabase() {
  const db = await getDb();
  if (!db) throw new Error("FMHY shared protection database is unavailable");
  return db;
}

export type FmhySharedSourceCacheRecord = {
  resourcesJson: string;
  freshUntil: Date;
};

export type FmhySharedSourceCacheRead = FmhySharedSourceCacheRecord | null;

export type FmhyPersistedProtectionPolicy = FmhyProtectionPolicyInput & {
  revision: number;
  updatedAt: Date;
};

export type FmhyProtectionCircuitState = {
  openUntil: Date | null;
};

export type FmhyProtectionMetric = {
  kind: string;
  count: number;
};

export class MySqlFmhySharedState implements FmhySharedAdmissionStore {
  async readProtectionPolicy(): Promise<FmhyPersistedProtectionPolicy> {
    const db = await requireSharedDatabase();
    const result = await db.execute(sql`
      SELECT revision, clientRequestsPerMinute, globalSearchesPerMinute, maxConcurrency,
             maxWaitingRequests, maxQueueWaitMs, circuitFailureThreshold, circuitCooldownMaxSeconds, updatedAt
      FROM fmhy_protection_policy
      WHERE id = 1
      LIMIT 1
    `);
    const row = rowsFromExecute(result)[0];
    if (!row) throw new Error("FMHY shared protection policy is unavailable");
    const policy = validateFmhyProtectionPolicy({
      clientRequestsPerMinute: Number(row.clientRequestsPerMinute),
      globalSearchesPerMinute: Number(row.globalSearchesPerMinute),
      maxConcurrency: Number(row.maxConcurrency),
      maxWaitingRequests: Number(row.maxWaitingRequests),
      maxQueueWaitMs: Number(row.maxQueueWaitMs),
      circuitFailureThreshold: Number(row.circuitFailureThreshold),
      circuitCooldownMaxSeconds: Number(row.circuitCooldownMaxSeconds),
    });
    const updatedAt = dateFromUnknown(row.updatedAt);
    if (!updatedAt) throw new Error("FMHY shared protection policy timestamp is invalid");
    return { ...policy, revision: Number(row.revision), updatedAt };
  }

  async updateProtectionPolicy(input: FmhyProtectionPolicyInput) {
    const policy = validateFmhyProtectionPolicy(input);
    const db = await requireSharedDatabase();
    await db.execute(sql`
      UPDATE fmhy_protection_policy
      SET clientRequestsPerMinute = ${policy.clientRequestsPerMinute},
          globalSearchesPerMinute = ${policy.globalSearchesPerMinute},
          maxConcurrency = ${policy.maxConcurrency},
          maxWaitingRequests = ${policy.maxWaitingRequests},
          maxQueueWaitMs = ${policy.maxQueueWaitMs},
          circuitFailureThreshold = ${policy.circuitFailureThreshold},
          circuitCooldownMaxSeconds = ${policy.circuitCooldownMaxSeconds},
          revision = revision + 1
      WHERE id = 1
    `);
    return this.readProtectionPolicy();
  }

  async readCircuit(): Promise<FmhyProtectionCircuitState> {
    const db = await requireSharedDatabase();
    const result = await db.execute(sql`
      SELECT openUntil FROM fmhy_protection_circuit WHERE provider = 'groq' LIMIT 1
    `);
    return { openUntil: dateFromUnknown(rowsFromExecute(result)[0]?.openUntil) };
  }

  async reportRateLimit(retryAfterSeconds = 60): Promise<FmhyProtectionCircuitState> {
    const db = await requireSharedDatabase();
    const now = new Date();
    const policy = await this.readProtectionPolicy();
    const requestedCooldown = Math.max(5, Math.min(policy.circuitCooldownMaxSeconds, retryAfterSeconds));
    return db.transaction(async tx => {
      const lockResult = await tx.execute(sql`SELECT GET_LOCK('fmhy-groq-circuit', 1) AS locked`);
      if (Number(rowsFromExecute(lockResult)[0]?.locked) !== 1) throw new Error("FMHY Groq circuit lock is unavailable");
      try {
        const result = await tx.execute(sql`
          SELECT failureCount, failureWindowStartedAt FROM fmhy_protection_circuit
          WHERE provider = 'groq' LIMIT 1 FOR UPDATE
        `);
        const row = rowsFromExecute(result)[0];
        const windowStartedAt = dateFromUnknown(row?.failureWindowStartedAt);
        const withinWindow = windowStartedAt && now.getTime() - windowStartedAt.getTime() < 60_000;
        const failureCount = withinWindow ? Number(row?.failureCount ?? 0) + 1 : 1;
        const nextWindow = withinWindow ? windowStartedAt as Date : now;
        const openUntil = failureCount >= policy.circuitFailureThreshold
          ? new Date(now.getTime() + requestedCooldown * 1_000)
          : null;
        await tx.execute(sql`
          INSERT INTO fmhy_protection_circuit (provider, failureCount, failureWindowStartedAt, openUntil)
          VALUES ('groq', ${failureCount}, ${nextWindow}, ${openUntil})
          ON DUPLICATE KEY UPDATE failureCount = VALUES(failureCount),
            failureWindowStartedAt = VALUES(failureWindowStartedAt), openUntil = VALUES(openUntil)
        `);
        return { openUntil };
      } finally {
        await tx.execute(sql`SELECT RELEASE_LOCK('fmhy-groq-circuit')`);
      }
    });
  }

  async readProtectionMetrics(minutes = 60): Promise<FmhyProtectionMetric[]> {
    const db = await requireSharedDatabase();
    const boundedMinutes = Math.max(1, Math.min(1_440, Math.floor(minutes)));
    const since = new Date(Date.now() - boundedMinutes * 60_000);
    const result = await db.execute(sql`
      SELECT kind, SUM(count) AS count FROM fmhy_protection_metrics
      WHERE minuteStartedAt >= ${since}
      GROUP BY kind ORDER BY kind ASC
    `);
    return rowsFromExecute(result).flatMap(row => typeof row.kind === "string"
      ? [{ kind: row.kind, count: Number(row.count ?? 0) }]
      : []);
  }

  async claimRateBucket(input: { scope: "client" | "global"; subjectHash: string }): Promise<FmhySharedRateBucketDecision> {
    const db = await requireSharedDatabase();
    const now = new Date();
    const window = currentWindow(now);
    const policy = await this.readProtectionPolicy();
    const maximum = input.scope === "client" ? policy.clientRequestsPerMinute : policy.globalSearchesPerMinute;
    const lockName = `fmhy-rate:${input.scope}:${input.subjectHash}:${window.start.getTime()}`.slice(0, 64);

    return db.transaction(async tx => {
      const lockResult = await tx.execute(sql`SELECT GET_LOCK(${lockName}, 1) AS locked`);
      if (Number(rowsFromExecute(lockResult)[0]?.locked) !== 1) return { allowed: false, retryAfterSeconds: 1 };

      try {
        const existing = await tx.execute(sql`
          SELECT requestCount, expiresAt
          FROM fmhy_rate_buckets
          WHERE scope = ${input.scope}
            AND subjectHash = ${input.subjectHash}
            AND windowStartedAt = ${window.start}
          LIMIT 1
          FOR UPDATE
        `);
        const row = rowsFromExecute(existing)[0];
        if (!row) {
          await tx.execute(sql`
            INSERT INTO fmhy_rate_buckets (scope, subjectHash, windowStartedAt, requestCount, expiresAt)
            VALUES (${input.scope}, ${input.subjectHash}, ${window.start}, 1, ${window.expiresAt})
          `);
          return { allowed: true };
        }

        const requestCount = Number(row.requestCount ?? Number.POSITIVE_INFINITY);
        const expiresAt = dateFromUnknown(row.expiresAt) ?? window.expiresAt;
        if (requestCount >= maximum) return { allowed: false, retryAfterSeconds: retryAfterSeconds(now, expiresAt) };

        await tx.execute(sql`
          UPDATE fmhy_rate_buckets
          SET requestCount = requestCount + 1
          WHERE scope = ${input.scope}
            AND subjectHash = ${input.subjectHash}
            AND windowStartedAt = ${window.start}
        `);
        return { allowed: true };
      } finally {
        await tx.execute(sql`SELECT RELEASE_LOCK(${lockName})`);
      }
    });
  }

  async acquireSearchLease(): Promise<FmhySharedSearchLeaseDecision> {
    const db = await requireSharedDatabase();
    const now = new Date();
    const policy = await this.readProtectionPolicy();
    const leaseId = randomUUID();
    const waitExpiresAt = new Date(now.getTime() + policy.maxQueueWaitMs);
    const queued = await db.transaction(async tx => {
      const lockResult = await tx.execute(sql`SELECT GET_LOCK('fmhychat-search-leases', 1) AS locked`);
      if (Number(rowsFromExecute(lockResult)[0]?.locked) !== 1) return false;

      try {
        await tx.execute(sql`DELETE FROM fmhy_search_leases WHERE expiresAt <= ${now}`);
        const waitingResult = await tx.execute(sql`
          SELECT COUNT(*) AS waitingCount
          FROM fmhy_search_leases
          WHERE status = 'waiting' AND expiresAt > ${now}
        `);
        const waitingCount = Number(rowsFromExecute(waitingResult)[0]?.waitingCount ?? Number.POSITIVE_INFINITY);
        if (waitingCount >= policy.maxWaitingRequests) return false;

        await tx.execute(sql`
          INSERT INTO fmhy_search_leases (leaseId, status, createdAt, expiresAt)
          VALUES (${leaseId}, 'waiting', ${now}, ${waitExpiresAt})
        `);
        return true;
      } finally {
        await tx.execute(sql`SELECT RELEASE_LOCK('fmhychat-search-leases')`);
      }
    });
    if (!queued) return { retryAfterSeconds: 5 };

    while (Date.now() < waitExpiresAt.getTime()) {
      const activated = await db.transaction(async tx => {
        const pollNow = new Date();
        const lockResult = await tx.execute(sql`SELECT GET_LOCK('fmhychat-search-leases', 1) AS locked`);
        if (Number(rowsFromExecute(lockResult)[0]?.locked) !== 1) return false;

        try {
          await tx.execute(sql`DELETE FROM fmhy_search_leases WHERE expiresAt <= ${pollNow}`);
          const firstWaiting = await tx.execute(sql`
            SELECT leaseId
            FROM fmhy_search_leases
            WHERE status = 'waiting' AND expiresAt > ${pollNow}
            ORDER BY createdAt ASC, leaseId ASC
            LIMIT 1
            FOR UPDATE
          `);
          if (rowsFromExecute(firstWaiting)[0]?.leaseId !== leaseId) return false;

          const activeResult = await tx.execute(sql`
            SELECT COUNT(*) AS activeCount
            FROM fmhy_search_leases
            WHERE status = 'active' AND expiresAt > ${pollNow}
          `);
          const activeCount = Number(rowsFromExecute(activeResult)[0]?.activeCount ?? Number.POSITIVE_INFINITY);
          if (activeCount >= policy.maxConcurrency) return false;

          const activeUntil = new Date(pollNow.getTime() + FMHY_SHARED_SEARCH_LEASE_MS);
          await tx.execute(sql`
            UPDATE fmhy_search_leases
            SET status = 'active', expiresAt = ${activeUntil}
            WHERE leaseId = ${leaseId} AND status = 'waiting'
          `);
          return true;
        } finally {
          await tx.execute(sql`SELECT RELEASE_LOCK('fmhychat-search-leases')`);
        }
      });
      if (activated) return { leaseId };
      await waitForSharedSearchSlot();
    }

    await db.execute(sql`DELETE FROM fmhy_search_leases WHERE leaseId = ${leaseId} AND status = 'waiting'`);
    return { retryAfterSeconds: 5 };
  }

  async releaseSearchLease(leaseId: string) {
    const db = await requireSharedDatabase();
    await db.execute(sql`DELETE FROM fmhy_search_leases WHERE leaseId = ${leaseId}`);
  }

  async incrementMetric(kind: string) {
    const db = await requireSharedDatabase();
    const now = new Date();
    const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    await db.execute(sql`
      INSERT INTO fmhy_protection_metrics (minuteStartedAt, kind, count)
      VALUES (${minute}, ${kind}, 1)
      ON DUPLICATE KEY UPDATE count = count + 1
    `);
  }

  async readFreshSourceCache(pageUrl: string): Promise<FmhySharedSourceCacheRead> {
    const db = await requireSharedDatabase();
    const now = new Date();
    const result = await db.execute(sql`
      SELECT resourcesJson, freshUntil
      FROM fmhy_source_cache
      WHERE pageUrl = ${pageUrl} AND freshUntil > ${now}
      LIMIT 1
    `);
    const row = rowsFromExecute(result)[0];
    if (typeof row?.resourcesJson !== "string") return null;
    const freshUntil = dateFromUnknown(row.freshUntil);
    return freshUntil ? { resourcesJson: row.resourcesJson, freshUntil } : null;
  }

  async claimSourceRefresh(pageUrl: string) {
    const db = await requireSharedDatabase();
    const now = new Date();
    const leaseId = randomUUID();
    const leaseUntil = new Date(now.getTime() + FMHY_SHARED_SOURCE_REFRESH_LEASE_MS);
    await db.execute(sql`
      INSERT INTO fmhy_source_cache (pageUrl, refreshLeaseId, refreshLeaseUntil)
      VALUES (${pageUrl}, ${leaseId}, ${leaseUntil})
      ON DUPLICATE KEY UPDATE
        refreshLeaseId = IF(refreshLeaseUntil IS NULL OR refreshLeaseUntil <= ${now}, VALUES(refreshLeaseId), refreshLeaseId),
        refreshLeaseUntil = IF(refreshLeaseUntil IS NULL OR refreshLeaseUntil <= ${now}, VALUES(refreshLeaseUntil), refreshLeaseUntil)
    `);
    const result = await db.execute(sql`
      SELECT refreshLeaseId
      FROM fmhy_source_cache
      WHERE pageUrl = ${pageUrl}
      LIMIT 1
    `);
    return rowsFromExecute(result)[0]?.refreshLeaseId === leaseId ? leaseId : null;
  }

  async writeSourceCache(pageUrl: string, refreshLeaseId: string, resourcesJson: string, freshUntil: Date) {
    const db = await requireSharedDatabase();
    await db.execute(sql`
      UPDATE fmhy_source_cache
      SET resourcesJson = ${resourcesJson},
          freshUntil = ${freshUntil},
          refreshLeaseId = NULL,
          refreshLeaseUntil = NULL
      WHERE pageUrl = ${pageUrl} AND refreshLeaseId = ${refreshLeaseId}
    `);
  }

  async releaseSourceRefresh(pageUrl: string, refreshLeaseId: string) {
    const db = await requireSharedDatabase();
    await db.execute(sql`
      UPDATE fmhy_source_cache
      SET refreshLeaseId = NULL, refreshLeaseUntil = NULL
      WHERE pageUrl = ${pageUrl} AND refreshLeaseId = ${refreshLeaseId}
    `);
  }
}

export const fmhySharedState = new MySqlFmhySharedState();

export function sharedFmhyStateRequired() {
  return ENV.isProduction;
}
