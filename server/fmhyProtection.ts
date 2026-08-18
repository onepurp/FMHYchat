import { createHmac, randomBytes } from "node:crypto";
import { ENV } from "./_core/env";

export const FMHY_SEARCH_LIMIT_WINDOW_MS = 60_000;
export const FMHY_SEARCH_LIMIT_MAX_REQUESTS = 3;
export const FMHY_GLOBAL_SEARCH_LIMIT_MAX_REQUESTS = 6;
export const FMHY_SEARCH_MAX_CONCURRENCY = 2;
export const FMHY_SEARCH_MAX_WAITING_REQUESTS = 10;
export const FMHY_SEARCH_QUEUE_RETRY_AFTER_SECONDS = 5;
export const FMHY_SEARCH_MAX_QUEUE_WAIT_MS = 4_000;
export const FMHY_GROQ_CIRCUIT_DEFAULT_RETRY_AFTER_SECONDS = 60;
export const FMHY_GROQ_CIRCUIT_MAX_RETRY_AFTER_SECONDS = 60;

export type FmhyProtectionPolicyInput = {
  clientRequestsPerMinute: number;
  globalSearchesPerMinute: number;
  maxConcurrency: number;
  maxWaitingRequests: number;
  maxQueueWaitMs: number;
  circuitFailureThreshold: number;
  circuitCooldownMaxSeconds: number;
};

function assertPolicyRange(field: string, value: number, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}.`);
  }
}

export function validateFmhyProtectionPolicy(input: FmhyProtectionPolicyInput) {
  assertPolicyRange("clientRequestsPerMinute", input.clientRequestsPerMinute, 1, 10);
  assertPolicyRange("globalSearchesPerMinute", input.globalSearchesPerMinute, 1, 30);
  assertPolicyRange("maxConcurrency", input.maxConcurrency, 1, 5);
  assertPolicyRange("maxWaitingRequests", input.maxWaitingRequests, 0, 25);
  assertPolicyRange("maxQueueWaitMs", input.maxQueueWaitMs, 1_000, 10_000);
  assertPolicyRange("circuitFailureThreshold", input.circuitFailureThreshold, 1, 5);
  assertPolicyRange("circuitCooldownMaxSeconds", input.circuitCooldownMaxSeconds, 5, 60);
  return input;
}

type RateLimitAllowed = { allowed: true };
type RateLimitBlocked = { allowed: false; retryAfterSeconds: number };
export type RateLimitDecision = RateLimitAllowed | RateLimitBlocked;

const opaqueClientKeySecret = ENV.adminSessionSecret || randomBytes(32).toString("base64url");

export function deriveOpaqueFmhyClientKey(secret: string, input: { userOpenId?: string | null; ipAddress?: string | null }) {
  const stableIdentity = input.userOpenId ? `user:${input.userOpenId}` : `ip:${input.ipAddress ?? "unknown"}`;
  return createHmac("sha256", secret).update(stableIdentity).digest("base64url");
}

export function opaqueFmhyClientKey(input: { userOpenId?: string | null; ipAddress?: string | null }) {
  return deriveOpaqueFmhyClientKey(opaqueClientKeySecret, input);
}

export class FmhySearchRateLimiter {
  private readonly requestsByClient = new Map<string, number[]>();

  constructor(private readonly maxRequests = FMHY_SEARCH_LIMIT_MAX_REQUESTS) {}

  check(clientKey: string, now = Date.now()): RateLimitDecision {
    const windowStart = now - FMHY_SEARCH_LIMIT_WINDOW_MS;
    const recentRequests = (this.requestsByClient.get(clientKey) ?? []).filter(requestTime => requestTime > windowStart);

    if (recentRequests.length >= this.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((recentRequests[0] + FMHY_SEARCH_LIMIT_WINDOW_MS - now) / 1_000));
      this.requestsByClient.set(clientKey, recentRequests);
      return { allowed: false, retryAfterSeconds };
    }

    recentRequests.push(now);
    this.requestsByClient.set(clientKey, recentRequests);
    return { allowed: true };
  }

  clearForTest() {
    this.requestsByClient.clear();
  }
}

export const fmhySearchRateLimiter = new FmhySearchRateLimiter();
export const fmhyGlobalSearchRateLimiter = new FmhySearchRateLimiter(FMHY_GLOBAL_SEARCH_LIMIT_MAX_REQUESTS);

export class FmhySearchQueueFullError extends Error {
  readonly retryAfterSeconds = FMHY_SEARCH_QUEUE_RETRY_AFTER_SECONDS;

  constructor() {
    super(`The FMHYchat search queue is full. Please try again in ${FMHY_SEARCH_QUEUE_RETRY_AFTER_SECONDS} seconds.`);
    this.name = "FmhySearchQueueFullError";
  }
}

export class FmhySearchQueueWaitExpiredError extends Error {
  readonly retryAfterSeconds = FMHY_SEARCH_QUEUE_RETRY_AFTER_SECONDS;

  constructor() {
    super(`The FMHYchat search queue wait expired. Please try again in ${FMHY_SEARCH_QUEUE_RETRY_AFTER_SECONDS} seconds.`);
    this.name = "FmhySearchQueueWaitExpiredError";
  }
}

type QueuedSearch = {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class FmhySearchQueue {
  private activeSearches = 0;
  private readonly waiting: QueuedSearch[] = [];

  constructor(private readonly options: {
    maxConcurrency: number;
    maxWaitingRequests: number;
    maxWaitMs: number;
  } = {
    maxConcurrency: FMHY_SEARCH_MAX_CONCURRENCY,
    maxWaitingRequests: FMHY_SEARCH_MAX_WAITING_REQUESTS,
    maxWaitMs: FMHY_SEARCH_MAX_QUEUE_WAIT_MS,
  }) {}

  run<T>(task: () => Promise<T>) {
    if (this.waiting.length >= this.options.maxWaitingRequests) {
      return Promise.reject<T>(new FmhySearchQueueFullError());
    }
    return new Promise<T>((resolve, reject) => {
      const queued: QueuedSearch = {
        task,
        resolve: value => resolve(value as T),
        reject,
        timer: setTimeout(() => this.expire(queued), this.options.maxWaitMs),
      };
      this.waiting.push(queued);
      this.startNext();
    });
  }

  private expire(queued: QueuedSearch) {
    const index = this.waiting.indexOf(queued);
    if (index < 0) return;
    this.waiting.splice(index, 1);
    queued.reject(new FmhySearchQueueWaitExpiredError());
  }

  private startNext() {
    while (this.activeSearches < this.options.maxConcurrency && this.waiting.length > 0) {
      const next = this.waiting.shift();
      if (!next) return;
      clearTimeout(next.timer);
      this.activeSearches += 1;
      void Promise.resolve()
        .then(next.task)
        .then(next.resolve, next.reject)
        .finally(() => {
          this.activeSearches -= 1;
          this.startNext();
        });
    }
  }

  clearForTest() {
    this.activeSearches = 0;
    for (const queued of this.waiting.splice(0)) clearTimeout(queued.timer);
  }
}

export const fmhySearchQueue = new FmhySearchQueue();

export type FmhySharedRateBucketDecision = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

export type FmhySharedSearchLeaseDecision = {
  leaseId?: string;
  retryAfterSeconds?: number;
};

export type FmhySharedAdmissionStore = {
  claimRateBucket: (input: { scope: "client" | "global"; subjectHash: string }) => Promise<FmhySharedRateBucketDecision>;
  acquireSearchLease: () => Promise<FmhySharedSearchLeaseDecision>;
  releaseSearchLease: (leaseId: string) => Promise<void>;
  incrementMetric: (kind: string) => Promise<void>;
};

export class FmhySharedProtectionUnavailableError extends Error {
  constructor() {
    super("Shared protection state is unavailable.");
    this.name = "FmhySharedProtectionUnavailableError";
  }
}

export class FmhySharedRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`FMHYchat is busy. Please try again in ${retryAfterSeconds} seconds.`);
    this.name = "FmhySharedRateLimitError";
  }
}

export type FmhyGroqCircuitStore = {
  readCircuit: () => Promise<{ openUntil: Date | null }>;
  reportRateLimit: (retryAfterSeconds?: number) => Promise<{ openUntil: Date | null }>;
};

export class FmhyGroqCircuitOpenError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Groq capacity is temporarily limited. Please try again in ${retryAfterSeconds} seconds.`);
    this.name = "FmhyGroqCircuitOpenError";
  }
}

function boundedGroqRetryAfterSeconds(openUntil: Date | null, now = Date.now()) {
  if (!openUntil) return 0;
  return Math.max(0, Math.min(
    FMHY_GROQ_CIRCUIT_MAX_RETRY_AFTER_SECONDS,
    Math.ceil((openUntil.getTime() - now) / 1_000),
  ));
}

export function createFmhyGroqCircuitBreaker(store: FmhyGroqCircuitStore) {
  return {
    async check() {
      const circuit = await store.readCircuit();
      const retryAfterSeconds = boundedGroqRetryAfterSeconds(circuit.openUntil);
      if (retryAfterSeconds > 0) throw new FmhyGroqCircuitOpenError(retryAfterSeconds);
    },
    async reportRateLimit(retryAfterSeconds?: number) {
      const boundedRetryAfter = Math.max(1, Math.min(
        FMHY_GROQ_CIRCUIT_MAX_RETRY_AFTER_SECONDS,
        retryAfterSeconds ?? FMHY_GROQ_CIRCUIT_DEFAULT_RETRY_AFTER_SECONDS,
      ));
      await store.reportRateLimit(boundedRetryAfter);
    },
  };
}

export function createFmhySharedAdmission(store: FmhySharedAdmissionStore) {
  const recordMetric = async (kind: string) => {
    try {
      await store.incrementMetric(kind);
    } catch {
      // Metrics are aggregate observability only and must not affect admission.
    }
  };

  return {
    async admit(clientKey: string) {
      try {
        const clientRate = await store.claimRateBucket({ scope: "client", subjectHash: clientKey });
        if (!clientRate.allowed) {
          await recordMetric("client_rate_limited");
          throw new FmhySharedRateLimitError(clientRate.retryAfterSeconds ?? FMHY_SEARCH_QUEUE_RETRY_AFTER_SECONDS);
        }

        const globalRate = await store.claimRateBucket({ scope: "global", subjectHash: "all" });
        if (!globalRate.allowed) {
          await recordMetric("global_rate_limited");
          throw new FmhySharedRateLimitError(globalRate.retryAfterSeconds ?? FMHY_SEARCH_QUEUE_RETRY_AFTER_SECONDS);
        }

        const lease = await store.acquireSearchLease();
        if (!lease.leaseId) {
          await recordMetric("queue_full_or_expired");
          throw new FmhySearchQueueFullError();
        }

        await recordMetric("allowed");
        return {
          leaseId: lease.leaseId,
          release: () => store.releaseSearchLease(lease.leaseId as string),
        };
      } catch (error) {
        if (error instanceof FmhySearchQueueFullError || error instanceof FmhySharedRateLimitError) throw error;
        await recordMetric("shared_state_unavailable");
        throw new FmhySharedProtectionUnavailableError();
      }
    },
  };
}
