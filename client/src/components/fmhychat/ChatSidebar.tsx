/** FMHY Reference Tool: a compact archive rail that prioritizes search history over decoration. */

import { BookOpen, ExternalLink, MessageSquareText, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import type { ChatSession } from "@/lib/chat";
import { BrandMark } from "./BrandMark";

type ChatSidebarProps = {
  activeId: string | null;
  isMobile?: boolean;
  onClose?: () => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  sessions: ChatSession[];
};

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}

export function ChatSidebar({ activeId, isMobile = false, onClose, onDelete, onNew, onSelect, sessions }: ChatSidebarProps) {
  return (
    <aside aria-label="Chat history" className={`fmhy-sidebar ${isMobile ? "fmhy-sidebar-mobile" : ""}`}>
      <div className="flex items-center justify-between gap-3 px-4 pb-5 pt-5">
        <BrandMark />
        {isMobile ? (
          <button aria-label="Close chat history" className="fmhy-icon-button" onClick={onClose} type="button">
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
      </div>

      <div className="px-3">
        <button className="fmhy-new-session" onClick={onNew} type="button">
          <Plus className="size-4" strokeWidth={2.25} />
          New session
        </button>
      </div>

      <div className="mt-7 flex min-h-0 flex-1 flex-col px-3">
        <div className="mb-2 flex items-center justify-between px-2">
          <p className="fmhy-sidebar-label">Recent searches</p>
          <span className="rounded-full bg-[#e2e2e3] px-2 py-0.5 text-[10px] font-semibold text-[#67676c] dark:bg-white/10 dark:text-[#98989f]">
            {sessions.length}
          </span>
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pb-4">
          {sessions.length ? (
            sessions.map((session) => (
              <div className="group relative" key={session.id}>
                <button
                  aria-current={session.id === activeId ? "page" : undefined}
                  className={`fmhy-history-item ${session.id === activeId ? "fmhy-history-item-active" : ""}`}
                  onClick={() => onSelect(session.id)}
                  type="button"
                >
                  <MessageSquareText className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate">{session.title}</span>
                    <span className="mt-1 block text-[11px] font-normal text-[#67676c] dark:text-[#98989f]">
                      {formatUpdatedAt(session.updatedAt)}
                    </span>
                  </span>
                </button>
                <button
                  aria-label={`Delete ${session.title}`}
                  className="fmhy-history-delete"
                  onClick={() => onDelete(session.id)}
                  type="button"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))
          ) : (
            <div className="px-2 pt-3 text-sm leading-6 text-[#67676c] dark:text-[#98989f]">
              Your FMHY searches will appear here.
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[#e2e2e3] p-3 dark:border-white/10">
        <a className="fmhy-library-link" href="https://fmhy.net" rel="noreferrer" target="_blank">
          <BookOpen className="size-4" />
          Browse FMHY
          <ExternalLink className="ml-auto size-3.5 opacity-60" />
        </a>
      </div>
    </aside>
  );
}
