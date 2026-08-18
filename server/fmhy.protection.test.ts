import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const { searchFmhyMock, sharedStateMock, sharedStateRequiredMock } = vi.hoisted(() => ({
  searchFmhyMock: vi.fn(),
  sharedStateRequiredMock: vi.fn(() => false),
  sharedStateMock: {
    claimRateBucket: vi.fn(),
    acquireSearchLease: vi.fn(),
    releaseSearchLease: vi.fn(),
    incrementMetric: vi.fn(),
    readCircuit: vi.fn(),
    reportRateLimit: vi.fn(),
  },
}));

vi.mock("./fmhy", () => ({ searchFmhy: searchFmhyMock }));
vi.mock("./fmhySharedState", () => ({
  fmhySharedState: sharedStateMock,
  sharedFmhyStateRequired: sharedStateRequiredMock,
}));

import { appRouter } from "./routers";
import * as protection from "./fmhyProtection";
import { FmhySearchQueue, fmhyGlobalSearchRateLimiter, fmhySearchQueue, fmhySearchRateLimiter } from "./fmhyProtection";

function createContext(clientSuffix = "10"): TrpcContext {
  return {
    isAdministrator: false,
    req: {
      headers: {},
      socket: { remoteAddress: `203.0.113.${clientSuffix}` },
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("FMHY public-search protection", () => {
  afterEach(() => {
    fmhySearchQueue.clearForTest();
    fmhyGlobalSearchRateLimiter.clearForTest();
    fmhySearchRateLimiter.clearForTest();
    sharedStateMock.claimRateBucket.mockReset();
    sharedStateMock.acquireSearchLease.mockReset();
    sharedStateMock.releaseSearchLease.mockReset();
    sharedStateMock.incrementMetric.mockReset();
    sharedStateMock.readCircuit.mockReset();
    sharedStateMock.reportRateLimit.mockReset();
    sharedStateRequiredMock.mockReset();
    sharedStateRequiredMock.mockReturnValue(false);
    vi.clearAllMocks();
  });

  it("derives the same opaque client key across instances that share a server secret", () => {
    const deriveOpaqueClientKey = (protection as typeof protection & {
      deriveOpaqueFmhyClientKey: (secret: string, input: { userOpenId?: string | null; ipAddress?: string | null }) => string;
    }).deriveOpaqueFmhyClientKey;

    expect(deriveOpaqueClientKey).toEqual(expect.any(Function));
    expect(deriveOpaqueClientKey("shared-server-secret", { ipAddress: "203.0.113.10" }))
      .toBe(deriveOpaqueClientKey("shared-server-secret", { ipAddress: "203.0.113.10" }));
    expect(deriveOpaqueClientKey("different-server-secret", { ipAddress: "203.0.113.10" }))
      .not.toBe(deriveOpaqueClientKey("shared-server-secret", { ipAddress: "203.0.113.10" }));
  });

  it("limits a repeated client and returns a safe retry-after message", async () => {
    searchFmhyMock.mockResolvedValue({ status: "NO_MATCH", answer: "No match", sources: [] });
    const caller = appRouter.createCaller(createContext());

    await caller.fmhy.search({ query: "audiobook resources" });
    await caller.fmhy.search({ query: "audiobook resources" });
    await caller.fmhy.search({ query: "audiobook resources" });

    await expect(caller.fmhy.search({ query: "audiobook resources" }))
      .rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
        message: expect.stringMatching(/try again in/i),
      });
    expect(searchFmhyMock).toHaveBeenCalledTimes(3);
  });

  it("runs only two FMHY searches concurrently and starts the next waiting request in order", async () => {
    const resolvers: Array<(value: { status: "NO_MATCH"; answer: string; sources: [] }) => void> = [];
    searchFmhyMock.mockImplementation(() => new Promise(resolve => {
      resolvers.push(resolve);
    }));
    const caller = appRouter.createCaller(createContext("queued-user"));
    const first = caller.fmhy.search({ query: "first request" });
    const second = caller.fmhy.search({ query: "second request" });
    const third = caller.fmhy.search({ query: "third request" });

    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(searchFmhyMock).toHaveBeenCalledTimes(2);

      resolvers.shift()?.({ status: "NO_MATCH", answer: "No match", sources: [] });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(searchFmhyMock).toHaveBeenCalledTimes(3);
    } finally {
      for (const resolve of resolvers.splice(0)) {
        resolve({ status: "NO_MATCH", answer: "No match", sources: [] });
      }
      await Promise.allSettled([first, second, third]);
    }
  });

  it("rejects an overflow queue with safe retry guidance instead of accepting unlimited waiting searches", async () => {
    type ConfigurableQueue = new (options: { maxConcurrency: number; maxWaitingRequests: number }) => FmhySearchQueue;
    const QueueWithConfig = FmhySearchQueue as unknown as ConfigurableQueue;
    const queue = new QueueWithConfig({ maxConcurrency: 1, maxWaitingRequests: 1 });
    const resolvers: Array<(value: string) => void> = [];
    const pendingTask = () => new Promise<string>(resolve => resolvers.push(resolve));

    const first = queue.run(pendingTask);
    const second = queue.run(pendingTask);
    const third = queue.run(pendingTask);

    try {
      const outcome = await Promise.race([
        third.then(() => "accepted", error => error instanceof Error ? error.message : "rejected"),
        new Promise<string>(resolve => setTimeout(() => resolve("still waiting"), 0)),
      ]);
      expect(outcome).toMatch(/queue is full.*try again in/i);
    } finally {
      for (const resolve of resolvers.splice(0)) resolve("complete");
      await new Promise(resolve => setTimeout(resolve, 0));
      for (const resolve of resolvers.splice(0)) resolve("complete");
      await Promise.allSettled([first, second, third]);
    }
  });

  it("expires a queued request with safe retry guidance when capacity does not free promptly", async () => {
    type TimeoutConfigurableQueue = new (options: {
      maxConcurrency: number;
      maxWaitingRequests: number;
      maxWaitMs: number;
    }) => FmhySearchQueue;
    const QueueWithTimeoutConfig = FmhySearchQueue as unknown as TimeoutConfigurableQueue;
    const queue = new QueueWithTimeoutConfig({ maxConcurrency: 1, maxWaitingRequests: 1, maxWaitMs: 10 });
    const resolvers: Array<(value: string) => void> = [];
    const pendingTask = () => new Promise<string>(resolve => resolvers.push(resolve));
    const first = queue.run(pendingTask);
    const second = queue.run(pendingTask);

    try {
      const outcome = await Promise.race([
        second.then(() => "accepted", error => error instanceof Error ? error.message : "rejected"),
        new Promise<string>(resolve => setTimeout(() => resolve("still waiting"), 30)),
      ]);
      expect(outcome).toMatch(/queue wait expired.*try again in/i);
    } finally {
      for (const resolve of resolvers.splice(0)) resolve("complete");
      await new Promise(resolve => setTimeout(resolve, 0));
      for (const resolve of resolvers.splice(0)) resolve("complete");
      await Promise.allSettled([first, second]);
    }
  });

  it("limits aggregate search starts even when each request comes from a different user", async () => {
    searchFmhyMock.mockResolvedValue({ status: "NO_MATCH", answer: "No match", sources: [] });

    for (let index = 0; index < 6; index += 1) {
      await appRouter.createCaller(createContext(`global-user-${index}`)).fmhy.search({ query: "audio resources" });
    }

    await expect(appRouter.createCaller(createContext("global-user-overflow")).fmhy.search({ query: "audio resources" }))
      .rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
        message: expect.stringMatching(/FMHYchat is busy.*try again in/i),
      });
  });

  it("labels unavailable shared admission without retry-countdown guidance", async () => {
    const createSharedAdmission = (protection as typeof protection & {
      createFmhySharedAdmission: (store: unknown) => { admit: (clientKey: string) => Promise<unknown> };
    }).createFmhySharedAdmission;

    expect(createSharedAdmission).toEqual(expect.any(Function));

    const admission = createSharedAdmission({
      claimRateBucket: vi.fn().mockRejectedValue(new Error("database offline")),
      acquireSearchLease: vi.fn(),
      releaseSearchLease: vi.fn(),
      incrementMetric: vi.fn(),
    });

    await expect(admission.admit("opaque-client-key")).rejects.toMatchObject({
      name: "FmhySharedProtectionUnavailableError",
      message: "Shared protection state is unavailable.",
    });
  });

  it("preserves a shared client retry time without consuming global capacity", async () => {
    const createSharedAdmission = (protection as typeof protection & {
      createFmhySharedAdmission: (store: unknown) => { admit: (clientKey: string) => Promise<unknown> };
    }).createFmhySharedAdmission;
    const store = {
      claimRateBucket: vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 31 }),
      acquireSearchLease: vi.fn(),
      releaseSearchLease: vi.fn(),
      incrementMetric: vi.fn().mockResolvedValue(undefined),
    };

    const admission = createSharedAdmission(store);

    await expect(admission.admit("opaque-client-key")).rejects.toMatchObject({
      name: "FmhySharedRateLimitError",
      retryAfterSeconds: 31,
    });
    expect(store.claimRateBucket).toHaveBeenCalledTimes(1);
    expect(store.acquireSearchLease).not.toHaveBeenCalled();
  });

  it("records an aggregate client-limit outcome without exposing the opaque client key", async () => {
    const createSharedAdmission = (protection as typeof protection & {
      createFmhySharedAdmission: (store: unknown) => { admit: (clientKey: string) => Promise<unknown> };
    }).createFmhySharedAdmission;
    const store = {
      claimRateBucket: vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 12 }),
      acquireSearchLease: vi.fn(),
      releaseSearchLease: vi.fn(),
      incrementMetric: vi.fn().mockResolvedValue(undefined),
    };

    const admission = createSharedAdmission(store);

    await expect(admission.admit("opaque-client-key")).rejects.toMatchObject({ retryAfterSeconds: 12 });
    expect(store.incrementMetric).toHaveBeenCalledWith("client_rate_limited");
    expect(store.incrementMetric).not.toHaveBeenCalledWith(expect.stringContaining("opaque-client-key"));
  });

  it("admits a search when its non-authoritative metrics write fails", async () => {
    const createSharedAdmission = (protection as typeof protection & {
      createFmhySharedAdmission: (store: unknown) => { admit: (clientKey: string) => Promise<unknown> };
    }).createFmhySharedAdmission;
    const store = {
      claimRateBucket: vi.fn().mockResolvedValue({ allowed: true }),
      acquireSearchLease: vi.fn().mockResolvedValue({ leaseId: "shared-lease" }),
      releaseSearchLease: vi.fn().mockResolvedValue(undefined),
      incrementMetric: vi.fn().mockRejectedValue(new Error("metrics unavailable")),
    };

    const admission = createSharedAdmission(store);

    await expect(admission.admit("opaque-client-key")).resolves.toMatchObject({ leaseId: "shared-lease" });
  });

  it("falls back to local protection when the shared circuit state is unavailable", async () => {
    sharedStateRequiredMock.mockReturnValue(true);
    sharedStateMock.readCircuit.mockRejectedValue(new Error("database offline"));
    searchFmhyMock.mockResolvedValue({ status: "NO_MATCH", answer: "No match", sources: [] });

    await expect(appRouter.createCaller(createContext("shared-store-user")).fmhy.search({ query: "music tools" }))
      .resolves.toMatchObject({ status: "NO_MATCH", answer: "No match" });
    expect(searchFmhyMock).toHaveBeenCalledTimes(1);
  });

  it("retains the shared Groq circuit retry when capacity is genuinely limited", async () => {
    sharedStateRequiredMock.mockReturnValue(true);
    sharedStateMock.readCircuit.mockResolvedValue({ openUntil: new Date(Date.now() + 5_000) });

    await expect(appRouter.createCaller(createContext("shared-circuit-user")).fmhy.search({ query: "music tools" }))
      .rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
        message: expect.stringMatching(/Groq capacity.*try again in/i),
      });
    expect(searchFmhyMock).not.toHaveBeenCalled();
  });

  it("opens the shared Groq circuit after the configured quota failures and blocks new work", async () => {
    const createCircuitBreaker = (protection as typeof protection & {
      createFmhyGroqCircuitBreaker: (store: {
        readCircuit: () => Promise<{ openUntil: Date | null }>;
        reportRateLimit: (retryAfterSeconds?: number) => Promise<{ openUntil: Date | null }>;
      }) => {
        check: () => Promise<void>;
        reportRateLimit: (retryAfterSeconds?: number) => Promise<void>;
      };
    }).createFmhyGroqCircuitBreaker;

    expect(createCircuitBreaker).toEqual(expect.any(Function));
    const openUntil = new Date(Date.now() + 30_000);
    const store = {
      readCircuit: vi.fn().mockResolvedValue({ openUntil }),
      reportRateLimit: vi.fn()
        .mockResolvedValueOnce({ openUntil: null })
        .mockResolvedValueOnce({ openUntil }),
    };
    const breaker = createCircuitBreaker(store);

    await breaker.reportRateLimit(30);
    await breaker.reportRateLimit(30);

    await expect(breaker.check()).rejects.toMatchObject({
      name: "FmhyGroqCircuitOpenError",
      retryAfterSeconds: expect.any(Number),
    });
    expect(store.reportRateLimit).toHaveBeenCalledTimes(2);
  });

  it("rejects an unsafe shared protection policy before it can reach the database", () => {
    const validatePolicy = (protection as typeof protection & {
      validateFmhyProtectionPolicy: (input: {
        clientRequestsPerMinute: number;
        globalSearchesPerMinute: number;
        maxConcurrency: number;
        maxWaitingRequests: number;
        maxQueueWaitMs: number;
        circuitFailureThreshold: number;
        circuitCooldownMaxSeconds: number;
      }) => unknown;
    }).validateFmhyProtectionPolicy;

    expect(validatePolicy).toEqual(expect.any(Function));
    expect(() => validatePolicy({
      clientRequestsPerMinute: 3,
      globalSearchesPerMinute: 31,
      maxConcurrency: 2,
      maxWaitingRequests: 10,
      maxQueueWaitMs: 4_000,
      circuitFailureThreshold: 2,
      circuitCooldownMaxSeconds: 60,
    })).toThrow(/global/i);
  });
});
