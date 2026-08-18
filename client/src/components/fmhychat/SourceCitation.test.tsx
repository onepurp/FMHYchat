import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceCitation } from "./SourceCitation";

describe("SourceCitation", () => {
  it("renders a compact direct resource link and a separate FMHY category link without a disclosure control", () => {
    const html = renderToStaticMarkup(
      <SourceCitation
        source={{
          label: "Audio Library",
          href: "https://fmhy.net/reading",
          resourceHref: "https://example.com/audiobooks",
          section: "Reading",
          relevance: "Direct match",
          excerpt: "Audiobooks and spoken-word media from a curated library.",
        }}
      />,
    );

    expect(html).toContain('href="https://example.com/audiobooks"');
    expect(html).toContain('href="https://fmhy.net/reading"');
    expect(html).toContain("Browse Reading on FMHY");
    expect(html).toContain("Audiobooks and spoken-word media");
    expect(html).not.toContain("<button");
  });
});
