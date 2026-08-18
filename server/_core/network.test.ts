import { describe, expect, it } from "vitest";
import { publicServerHost } from "./network";

describe("publicServerHost", () => {
  it("binds the production service to Render's public network interface", () => {
    expect(publicServerHost()).toBe("0.0.0.0");
  });
});
