import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_MAX_AGE_MS } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { AdminLoginRateLimitError, authenticateAdministratorPassword, createAdministratorSessionToken } from "./adminAuth";
import { searchFmhy } from "./fmhy";
import {
  createFmhySharedAdmission,
  createFmhyGroqCircuitBreaker,
  FmhyGroqCircuitOpenError,
  FmhySearchQueueFullError,
  FmhySearchQueueWaitExpiredError,
  FmhySharedProtectionUnavailableError,
  FmhySharedRateLimitError,
  fmhyGlobalSearchRateLimiter,
  fmhySearchQueue,
  fmhySearchRateLimiter,
  opaqueFmhyClientKey,
} from "./fmhyProtection";
import { fmhySharedState, sharedFmhyStateRequired } from "./fmhySharedState";

const fmhySharedAdmission = createFmhySharedAdmission(fmhySharedState);
const fmhyGroqCircuitBreaker = createFmhyGroqCircuitBreaker(fmhySharedState);

function fmhySearchClientKey(ctx: { req: { ip?: string; socket: { remoteAddress?: string | undefined } } }) {
  return opaqueFmhyClientKey({
    ipAddress: ctx.req.ip ?? ctx.req.socket.remoteAddress,
  });
}

export const appRouter = router({
  adminAuth: router({
    status: publicProcedure.query(({ ctx }) => ({ authenticated: ctx.isAdministrator } as const)),
    login: publicProcedure
      .input(z.object({ password: z.string().min(1).max(1_024) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const authenticated = await authenticateAdministratorPassword(ctx.req, input.password);
          if (!authenticated) throw new TRPCError({ code: "UNAUTHORIZED", message: "The administrator password is incorrect." });
        } catch (error) {
          if (error instanceof AdminLoginRateLimitError) {
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error.message });
          }
          throw error;
        }

        const token = await createAdministratorSessionToken();
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(ADMIN_SESSION_COOKIE, token, {
          ...cookieOptions,
          sameSite: "strict",
          maxAge: ADMIN_SESSION_MAX_AGE_MS,
        });
        return { authenticated: true } as const;
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(ADMIN_SESSION_COOKIE, { ...cookieOptions, sameSite: "strict" });
      return { authenticated: false } as const;
    }),
  }),

  fmhy: router({
    search: publicProcedure
      .input(z.object({
        query: z.string().min(1).max(240),
        context: z.object({
          previousQuery: z.string().min(1).max(240),
          shownResources: z.array(z.object({
            label: z.string().min(1).max(100),
            section: z.string().min(1).max(60),
          })).max(15),
        }).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const clientKey = fmhySearchClientKey(ctx);
        if (sharedFmhyStateRequired()) {
          try {
            await fmhyGroqCircuitBreaker.check();
            const admission = await fmhySharedAdmission.admit(clientKey);
            try {
              const response = await searchFmhy(input.query, input.context);
              const retryMatch = response.status === "UNAVAILABLE"
                ? response.answer.match(/temporarily rate limited\. Please try again in (\d+) seconds/i)
                : null;
              if (retryMatch?.[1]) await fmhyGroqCircuitBreaker.reportRateLimit(Number(retryMatch[1]));
              return response;
            } finally {
              await admission.release().catch(() => undefined);
            }
          } catch (error) {
            if (
              error instanceof FmhySearchQueueFullError
              || error instanceof FmhySharedRateLimitError
              || error instanceof FmhySharedProtectionUnavailableError
              || error instanceof FmhyGroqCircuitOpenError
            ) {
              throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error.message });
            }
            console.error("[FMHY] Shared protection failed", error);
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "FMHYchat protection is temporarily unavailable. Please try again in 5 seconds.",
            });
          }
        }

        const limit = fmhySearchRateLimiter.check(clientKey);
        if (!limit.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `FMHYchat is receiving too many requests from this client. Please try again in ${limit.retryAfterSeconds} seconds.`,
          });
        }
        const globalLimit = fmhyGlobalSearchRateLimiter.check("global");
        if (!globalLimit.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `FMHYchat is busy. Please try again in ${globalLimit.retryAfterSeconds} seconds.`,
          });
        }
        try {
          return await fmhySearchQueue.run(() => searchFmhy(input.query, input.context));
        } catch (error) {
          if (error instanceof FmhySearchQueueFullError || error instanceof FmhySearchQueueWaitExpiredError) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: error.message,
            });
          }
          console.error("[FMHY] Search failed", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The FMHY database is temporarily unavailable. Please try again shortly.",
          });
        }
      }),
  }),

  operations: router({
    overview: adminProcedure.query(async () => {
      const [policy, circuit, metrics] = await Promise.all([
        fmhySharedState.readProtectionPolicy(),
        fmhySharedState.readCircuit(),
        fmhySharedState.readProtectionMetrics(),
      ]);
      return { policy, circuit, metrics };
    }),
    updatePolicy: adminProcedure
      .input(z.object({
        clientRequestsPerMinute: z.number().int(),
        globalSearchesPerMinute: z.number().int(),
        maxConcurrency: z.number().int(),
        maxWaitingRequests: z.number().int(),
        maxQueueWaitMs: z.number().int(),
        circuitFailureThreshold: z.number().int(),
        circuitCooldownMaxSeconds: z.number().int(),
      }))
      .mutation(({ input }) => fmhySharedState.updateProtectionPolicy(input)),
  }),
});

export type AppRouter = typeof appRouter;
