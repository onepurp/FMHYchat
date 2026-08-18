import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { jwtVerify, SignJWT } from "jose";
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_MAX_AGE_MS } from "@shared/const";
import { ENV } from "./_core/env";

const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const ADMIN_LOGIN_MAX_ATTEMPTS = 5;

const attemptedLoginsByClient = new Map<string, number[]>();

export class AdminLoginRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Too many administrator password attempts. Please try again in ${retryAfterSeconds} seconds.`);
    this.name = "AdminLoginRateLimitError";
  }
}

function sessionSecret() {
  if (!ENV.adminSessionSecret) throw new Error("Administrator session secret is not configured");
  return new TextEncoder().encode(ENV.adminSessionSecret);
}

function configuredPassword() {
  if (!ENV.adminPassword) throw new Error("Administrator password is not configured");
  return ENV.adminPassword;
}

function requestIpAddress(req: Request) {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

function opaqueLoginClientKey(req: Request) {
  const secret = ENV.adminSessionSecret || "unconfigured-admin-session-secret";
  return createHmac("sha256", secret).update(requestIpAddress(req)).digest("base64url");
}

function passwordDigest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

function passwordMatches(submittedPassword: string) {
  return timingSafeEqual(passwordDigest(submittedPassword), passwordDigest(configuredPassword()));
}

function admitLoginAttempt(clientKey: string, now = Date.now()) {
  const windowStart = now - ADMIN_LOGIN_WINDOW_MS;
  const recentAttempts = (attemptedLoginsByClient.get(clientKey) ?? []).filter(attemptedAt => attemptedAt > windowStart);
  if (recentAttempts.length >= ADMIN_LOGIN_MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((recentAttempts[0] + ADMIN_LOGIN_WINDOW_MS - now) / 1_000));
    attemptedLoginsByClient.set(clientKey, recentAttempts);
    throw new AdminLoginRateLimitError(retryAfterSeconds);
  }
  attemptedLoginsByClient.set(clientKey, [...recentAttempts, now]);
}

export async function authenticateAdministratorPassword(req: Request, submittedPassword: string) {
  const clientKey = opaqueLoginClientKey(req);
  admitLoginAttempt(clientKey);
  const authenticated = passwordMatches(submittedPassword);
  if (authenticated) attemptedLoginsByClient.delete(clientKey);
  return authenticated;
}

export async function createAdministratorSessionToken() {
  const now = Date.now();
  return new SignJWT({ scope: "fmhy-operations-admin" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(Math.floor(now / 1_000))
    .setExpirationTime(Math.floor((now + ADMIN_SESSION_MAX_AGE_MS) / 1_000))
    .sign(sessionSecret());
}

export async function requestHasAdministratorSession(req: Request) {
  const cookieHeader = req.headers.cookie;
  const cookieValue = cookieHeader
    ?.split(";")
    .map(part => part.trim().split("=", 2))
    .find(([name]) => name === ADMIN_SESSION_COOKIE)?.[1];
  if (!cookieValue) return false;

  try {
    const { payload } = await jwtVerify(cookieValue, sessionSecret(), { algorithms: ["HS256"] });
    return payload.scope === "fmhy-operations-admin";
  } catch {
    return false;
  }
}

export function clearAdminLoginRateLimitForTest() {
  attemptedLoginsByClient.clear();
}
