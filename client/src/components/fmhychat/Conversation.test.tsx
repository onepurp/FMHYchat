import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Conversation } from "./Conversation";
import * as conversation from "./Conversation";

vi.mock("streamdown", () => ({
  Streamdown: ({ children, components }: { children: string; components?: { a?: (props: { href: string; children: string }) => unknown } }) => {
    const match = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/.exec(children);
    return match && components?.a ? components.a({ children: match[1] ?? "", href: match[2] ?? "" }) : children;
  },
}));

describe("Conversation", () => {
  it("renders retrieved Markdown resource references as safe direct links in assistant responses", () => {
    const html = renderToStaticMarkup(
      <Conversation
        messages={[
          {
            id: "answer-1",
            role: "assistant",
            createdAt: "2026-08-16T16:00:00.000Z",
            content: "FMHY lists [Audio Library](https://example.com/audiobooks) as a relevant option.",
          },
        ]}
        onCopy={vi.fn()}
      />,
    );

    expect(html).toContain('href="https://example.com/audiobooks"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("fmhy-markdown-link");
  });

  it("treats a conversation viewport within 24px of the end as already at the latest message", () => {
    const isNearConversationEnd = Reflect.get(conversation, "isNearConversationEnd") as
      | ((metrics: { scrollTop: number; clientHeight: number; scrollHeight: number }) => boolean)
      | undefined;

    expect(isNearConversationEnd).toBeTypeOf("function");
    if (!isNearConversationEnd) return;
    expect(isNearConversationEnd({ scrollTop: 476, clientHeight: 500, scrollHeight: 1_000 })).toBe(true);
    expect(isNearConversationEnd({ scrollTop: 450, clientHeight: 500, scrollHeight: 1_000 })).toBe(false);
  });

  it("renders a replay action for a completed assistant answer when the FMHY-only handler is supplied", () => {
    const html = renderToStaticMarkup(
      React.createElement(Conversation, {
        messages: [{
          id: "assistant-1",
          role: "assistant",
          createdAt: "2026-08-16T16:00:00.000Z",
          content: "A grounded FMHY answer.",
        }],
        onCopy: vi.fn(),
        onReplay: vi.fn(),
      } as unknown as React.ComponentProps<typeof Conversation>),
    );

    expect(html).toContain('aria-label="Retry FMHY search"');
  });

  it("labels an unversioned saved assistant answer as an earlier result without hiding it", () => {
    const html = renderToStaticMarkup(
      <Conversation
        messages={[{
          id: "assistant-legacy",
          role: "assistant",
          createdAt: "2026-08-16T16:00:00.000Z",
          content: "An earlier saved FMHY answer.",
        }]}
        onCopy={vi.fn()}
        onReplay={vi.fn()}
      />,
    );

    expect(html).toContain("Earlier result");
    expect(html).toContain("An earlier saved FMHY answer.");
  });

  it("provides an accessible return-to-latest control for the workspace to display when the reader scrolls away", () => {
    const ScrollToLatestButton = Reflect.get(conversation, "ScrollToLatestButton") as
      | ((props: { onClick: () => void }) => React.ReactNode)
      | undefined;

    expect(ScrollToLatestButton).toBeTypeOf("function");
    if (!ScrollToLatestButton) return;
    const html = renderToStaticMarkup(<ScrollToLatestButton onClick={vi.fn()} />);
    expect(html).toContain('aria-label="Scroll to latest message"');
    expect(html).toContain("Latest");
  });

  it("derives distinct source-row keys when multiple resources share the same FMHY category URL", () => {
    const sourceRowKey = Reflect.get(conversation, "sourceRowKey") as
      | ((source: { href: string; resourceHref?: string; label: string }, index: number) => string)
      | undefined;

    expect(sourceRowKey).toBeTypeOf("function");
    if (!sourceRowKey) return;

    const bdeBooks = sourceRowKey({ href: "https://fmhy.net/reading", resourceHref: "https://bdebooks.com", label: "BDeBooks" }, 0);
    const ebookPdf = sourceRowKey({ href: "https://fmhy.net/reading", resourceHref: "https://ebookpdf.com", label: "Ebook PDF" }, 1);

    expect(bdeBooks).not.toBe(ebookPdf);
  });
});
