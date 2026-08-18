const RETRY_AFTER_PATTERN = /try again in\s+(\d{1,2})\s+seconds?/i;
const MAX_RETRY_SECONDS = 60;
const NON_CAPACITY_RETRY_CONTEXT = /\b(?:shared protection|protection state|protection is temporarily unavailable|database is temporarily unavailable)\b/i;

export function retryAfterSecondsFromMessage(message: string) {
  if (NON_CAPACITY_RETRY_CONTEXT.test(message)) return null;
  const match = RETRY_AFTER_PATTERN.exec(message);
  const seconds = Number(match?.[1]);
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= MAX_RETRY_SECONDS ? seconds : null;
}

export function formatRetryCountdown(seconds: number) {
  const safeSeconds = Math.max(1, Math.min(MAX_RETRY_SECONDS, Math.ceil(seconds)));
  return `Please wait ${safeSeconds} ${safeSeconds === 1 ? "second" : "seconds"} before trying again.`;
}
