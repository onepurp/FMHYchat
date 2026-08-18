import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatComposer } from "./ChatComposer";

vi.stubGlobal("React", React);

describe("ChatComposer", () => {
  it("exposes the remaining characters and enforces the FMHY 240-character query maximum", () => {
    const html = renderToStaticMarkup(
      <ChatComposer
        availabilityMessage="Live FMHY database · Sources included"
        error={null}
        isSubmitting={false}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        value="ebook"
      />,
    );

    expect(html).toContain('maxLength="240"');
    expect(html).toContain("235 characters remaining");
  });

  it("replaces the sending action with an explicit cancellation control while a search is pending", () => {
    const html = renderToStaticMarkup(
      <ChatComposer
        availabilityMessage="Searching the FMHY database…"
        error={null}
        isSubmitting
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        value="ebook library"
      />,
    );

    expect(html).toContain('aria-label="Cancel search"');
    expect(html).toContain("Cancel");
  });
});
