import { describe, expect, it } from "vitest";
import { canLoadOperations, operationsAccessNotice } from "./access";

describe("operations access notices", () => {
  it("gives visitors a password-only Operations recovery path without an account requirement", () => {
    expect(operationsAccessNotice(false)).toEqual({
      heading: "Unlock Operations",
      detail: "Enter the administrator password to view aggregate protection health. Public FMHY search remains available without an account.",
      actionLabel: "Unlock Operations",
    });
  });

  it("allows the protected Operations query only for a confirmed password session", () => {
    expect(canLoadOperations(false)).toBe(false);
    expect(canLoadOperations(true)).toBe(true);
  });
});
