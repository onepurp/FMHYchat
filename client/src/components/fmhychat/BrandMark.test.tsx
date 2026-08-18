import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BrandMark } from "./BrandMark";

vi.stubGlobal("React", React);

describe("BrandMark", () => {
  it("uses the supplied play mark as the accessible FMHYchat logo", () => {
    const html = renderToStaticMarkup(<BrandMark />);

    expect(html).toContain('src="/manus-storage/fmhychat-play-mark_99e21d37.png"');
    expect(html).toContain('alt="FMHYchat"');
    expect(html).not.toContain("<svg");
  });
});
