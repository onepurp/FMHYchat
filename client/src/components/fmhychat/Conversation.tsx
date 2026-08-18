/** FMHY Reference Tool: present answers as readable editorial surfaces and sources as separate evidence. */

import React from "react";
import { ArrowDown, Bot, Copy, RotateCcw, UserRound } from "lucide-react";
import { Streamdown } from "streamdown";
import { isHistoricalFmhyResult, type ChatMessage } from "@/lib/chat";
import { SourceCitation } from "./SourceCitation";

type ConversationProps = {
  messages: ChatMessage[];
  onCopy: (message: ChatMessage) => void;
  onReplay?: (message: ChatMessage) => void;
};

export function isNearConversationEnd({ scrollTop, clientHeight, scrollHeight }: { scrollTop: number; clientHeight: number; scrollHeight: number }) {
  return scrollHeight - (scrollTop + clientHeight) <= 24;
}

export function ScrollToLatestButton({ onClick }: { onClick: () => void }) {
  return (
    <button aria-label="Scroll to latest message" className="fmhy-scroll-latest" onClick={onClick} type="button">
      <ArrowDown className="size-3.5" strokeWidth={2.5} />
      Latest
    </button>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function safeExternalHref(href?: string) {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <Streamdown
      components={{
        a: ({ children, href }) => {
          const safeHref = safeExternalHref(href);
          if (!safeHref) return <span>{children}</span>;
          return <a className="fmhy-markdown-link" href={safeHref} rel="noreferrer" target="_blank">{children}</a>;
        },
      }}
    >
      {content}
    </Streamdown>
  );
}

export function sourceRowKey(
  source: { href: string; resourceHref?: string; label: string },
  index: number,
) {
  return `${source.resourceHref ?? source.href}:${source.label}:${index}`;
}

export function Conversation({ messages, onCopy, onReplay }: ConversationProps) {
  return (
    <section aria-label="Conversation" className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-7 lg:px-10">
      <div className="space-y-7">
        {messages.map((message) => (
          <article className={`fmhy-message ${message.role === "user" ? "fmhy-message-user" : "fmhy-message-assistant"}`} key={message.id}>
            <div className="fmhy-message-avatar" aria-hidden="true">
              {message.role === "user" ? <UserRound className="size-3.5" /> : <Bot className="size-3.5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-semibold text-[#3c3c43] dark:text-[#dfdfd6]">
                  {message.role === "user" ? "You" : "FMHYchat"}
                </span>
                <time className="text-xs text-[#67676c] dark:text-[#98989f]">{formatTime(message.createdAt)}</time>
                {isHistoricalFmhyResult(message) ? (
                  <span
                    aria-label="Earlier result. Use Retry FMHY search to refresh this answer."
                    className="rounded-full border border-[#b7d6ef] bg-[#edf6fd] px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.02em] text-[#355697] dark:border-[#355697] dark:bg-[#203a52] dark:text-[#a8d1ef]"
                    title="Use Retry FMHY search to refresh this answer."
                  >
                    Earlier result
                  </span>
                ) : null}
              </div>
              <div className="fmhy-message-body">
                {message.role === "assistant"
                  ? <AssistantMarkdown content={message.content} />
                  : message.content.split("\n").map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
              {message.sources?.length ? (
                <div className="mt-4 space-y-2.5">
                  <p className="fmhy-evidence-label">FMHY sources</p>
                  {message.sources.map((source, index) => <SourceCitation key={sourceRowKey(source, index)} source={source} />)}
                </div>
              ) : null}
              {message.role === "assistant" ? (
                <div className="mt-3 flex items-center gap-1">
                  <button aria-label="Copy answer" className="fmhy-message-action" onClick={() => onCopy(message)} type="button">
                    <Copy className="size-3.5" />
                  </button>
                  {onReplay ? (
                    <button aria-label="Retry FMHY search" className="fmhy-message-action" onClick={() => onReplay(message)} type="button">
                      <RotateCcw className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
