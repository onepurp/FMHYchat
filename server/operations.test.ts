import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function operationsContext(isAdministrator: boolean): TrpcContext {
  return {
    isAdministrator,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("operations access", () => {
  it("rejects an anonymous caller before exposing aggregate protection metrics", async () => {
    const caller = appRouter.createCaller(operationsContext(false));

    await expect((caller as typeof caller & {
      operations: { overview: () => Promise<unknown> };
    }).operations.overview()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
