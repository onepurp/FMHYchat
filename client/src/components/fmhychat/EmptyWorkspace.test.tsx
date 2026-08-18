import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EmptyWorkspace } from "./EmptyWorkspace";

vi.stubGlobal("React", React);

describe("EmptyWorkspace", () => {
  it("keeps its provenance preview while marking secondary explanation for compact screens", () => {
    const html = renderToStaticMarkup(<EmptyWorkspace onSuggestion={vi.fn()} />);

    expect(html).toContain("Citation preview");
    expect(html).toContain("fmhy-empty-preview-detail");
  });
});
