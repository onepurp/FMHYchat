import { describe, expect, it } from "vitest";
import { formatRetryCountdown, retryAfterSecondsFromMessage } from "./retry";

describe("retry countdown helpers", () => {
  it("extracts only bounded retry timing from a safe server message", () => {
    expect(retryAfterSecondsFromMessage("FMHYchat is busy. Please try again in 5 seconds.")).toBe(5);
    expect(retryAfterSecondsFromMessage("The FMHY database is temporarily unavailable.")).toBeNull();
    expect(retryAfterSecondsFromMessage("Shared protection state is unavailable. Please try again in 5 seconds.")).toBeNull();
    expect(retryAfterSecondsFromMessage("Try again in 90 seconds.")).toBeNull();
  });

  it("formats singular and plural countdown messages without auto-retrying", () => {
    expect(formatRetryCountdown(1)).toBe("Please wait 1 second before trying again.");
    expect(formatRetryCountdown(5)).toBe("Please wait 5 seconds before trying again.");
  });
});
