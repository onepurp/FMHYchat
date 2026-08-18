import { afterEach, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { clearAdminLoginRateLimitForTest } from "./adminAuth";
import type { TrpcContext } from "./_core/context";

type CookieCall = { name: string; value: string; options: Record<string, unknown> };

function publicContext(): { ctx: TrpcContext; cookies: CookieCall[] } {
  const cookies: CookieCall[] = [];
  return {
    ctx: {
      isAdministrator: false,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {
        cookie: (name: string, value: string, options: Record<string, unknown>) => {
          cookies.push({ name, value, options });
        },
        clearCookie: (name: string, options: Record<string, unknown>) => {
          cookies.push({ name, value: "", options });
        },
      } as TrpcContext["res"],
    },
    cookies,
  };
}

describe("administrator password login", () => {
  afterEach(() => clearAdminLoginRateLimitForTest());

  it("validates the configured environment password through the login procedure and issues an httpOnly session", async () => {
    const configuredPassword = process.env.FMHY_ADMIN_PASSWORD;
    expect(configuredPassword).toBeTruthy();

    const { ctx, cookies } = publicContext();
    const caller = appRouter.createCaller(ctx) as unknown as {
      adminAuth: { login(input: { password: string }): Promise<{ authenticated: true }> };
    };

    await expect(caller.adminAuth.login({ password: configuredPassword! })).resolves.toEqual({ authenticated: true });
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.options).toMatchObject({ httpOnly: true, secure: true, path: "/" });
  });

  it("rejects an incorrect password without setting an administrator session", async () => {
    const { ctx, cookies } = publicContext();
    const caller = appRouter.createCaller(ctx) as unknown as {
      adminAuth: { login(input: { password: string }): Promise<unknown> };
    };

    await expect(caller.adminAuth.login({ password: "not-the-administrator-password" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(cookies).toEqual([]);
  });

  it("rate-limits repeated password attempts with a retry response", async () => {
    const { ctx } = publicContext();
    const caller = appRouter.createCaller(ctx) as unknown as {
      adminAuth: { login(input: { password: string }): Promise<unknown> };
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(caller.adminAuth.login({ password: "wrong" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    await expect(caller.adminAuth.login({ password: "wrong" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("clears the administrator session without the deprecated maxAge option", async () => {
    const { ctx, cookies } = publicContext();
    const caller = appRouter.createCaller(ctx) as unknown as {
      adminAuth: { logout(): Promise<{ authenticated: false }> };
    };

    await expect(caller.adminAuth.logout()).resolves.toEqual({ authenticated: false });
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.options).not.toHaveProperty("maxAge");
  });
});
