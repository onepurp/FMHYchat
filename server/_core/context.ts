import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { requestHasAdministratorSession } from "../adminAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  isAdministrator: boolean;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  return {
    req: opts.req,
    res: opts.res,
    isAdministrator: await requestHasAdministratorSession(opts.req),
  };
}
