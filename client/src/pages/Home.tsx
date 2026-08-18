/** FMHY Reference Tool: the main workspace keeps FMHY citations and conversational search central. */

import { Check, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  archiveSessions,
  buildFmhySessionContext,
  createId,
  createSession,
  getReplayPrompt,
  shouldApplyFmhyResult,
  messageFromFmhyResult,
  normalizeStoredWorkspace,
  restoreDeletedSession,
  titleFromPrompt,
  validateChatPrompt,
  type ChatMessage,
  type ChatSession,
  type ChatWorkspace,
} from "@/lib/chat";
import { trpc } from "@/lib/trpc";
import { formatRetryCountdown, retryAfterSecondsFromMessage } from "@/lib/retry";
import { BrandMark } from "@/components/fmhychat/BrandMark";
import { ChatComposer } from "@/components/fmhychat/ChatComposer";
import { ChatSidebar } from "@/components/fmhychat/ChatSidebar";
import { Conversation } from "@/components/fmhychat/Conversation";
import { isNearConversationEnd, ScrollToLatestButton } from "@/components/fmhychat/Conversation";
import { EmptyWorkspace } from "@/components/fmhychat/EmptyWorkspace";

type StoredWorkspace = ChatWorkspace;
type ActiveFmhySearch = { query: string; requestId: string; sessionId: string };

const STORAGE_KEY = "fmhychat-reference-workspace";

function loadWorkspace(): StoredWorkspace {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? normalizeStoredWorkspace(JSON.parse(stored) as StoredWorkspace) : { activeId: null, sessions: [] };
  } catch {
    return { activeId: null, sessions: [] };
  }
}

export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const [workspace, setWorkspace] = useState<StoredWorkspace>({ activeId: null, sessions: [] });
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retryUntil, setRetryUntil] = useState<number | null>(null);
  const [retryClock, setRetryClock] = useState(Date.now());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deletedSession, setDeletedSession] = useState<ChatSession | null>(null);
  const [activeSearch, setActiveSearch] = useState<ActiveFmhySearch | null>(null);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const activeSearchRef = useRef<ActiveFmhySearch | null>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const isAtConversationEndRef = useRef(true);
  const fmhySearch = trpc.fmhy.search.useMutation();

  useEffect(() => {
    setWorkspace(loadWorkspace());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  }, [hydrated, workspace]);

  const activeSession = useMemo(
    () => workspace.sessions.find((session) => session.id === workspace.activeId) ?? null,
    [workspace],
  );

  const visibleSessions = useMemo(() => archiveSessions(workspace.sessions), [workspace.sessions]);

  const isSearching = activeSearch !== null;
  const retrySecondsRemaining = retryUntil ? Math.max(0, Math.ceil((retryUntil - retryClock) / 1_000)) : null;

  useEffect(() => {
    if (!retryUntil) return;
    const timer = window.setInterval(() => setRetryClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [retryUntil]);

  useEffect(() => {
    if (retrySecondsRemaining !== 0 || !retryUntil) return;
    setRetryUntil(null);
  }, [retrySecondsRemaining, retryUntil]);

  function clearActiveSearch() {
    activeSearchRef.current = null;
    setActiveSearch(null);
  }

  function scrollToLatestMessage() {
    const scrollContainer = mainScrollRef.current;
    if (!scrollContainer) return;
    scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: "smooth" });
    isAtConversationEndRef.current = true;
    setShowScrollToLatest(false);
  }

  function handleConversationScroll() {
    const scrollContainer = mainScrollRef.current;
    if (!scrollContainer) return;
    const isAtEnd = isNearConversationEnd(scrollContainer);
    isAtConversationEndRef.current = isAtEnd;
    setShowScrollToLatest(!isAtEnd);
  }

  useEffect(() => {
    if (!activeSession?.messages.length || !isAtConversationEndRef.current) return;
    const frame = window.requestAnimationFrame(scrollToLatestMessage);
    return () => window.cancelAnimationFrame(frame);
  }, [activeSession?.messages.length]);

  useEffect(() => {
    isAtConversationEndRef.current = true;
    setShowScrollToLatest(false);
  }, [activeSession?.id]);

  function startNewSession() {
    clearActiveSearch();
    setWorkspace((current) => ({ ...current, activeId: null }));
    setDraft("");
    setError(null);
    setRetryUntil(null);
    setDeletedSession(null);
    setSidebarOpen(false);
  }

  function submitPrompt(prompt = draft, options?: { replayAssistantId?: string; sessionId?: string }) {
    const validation = validateChatPrompt(prompt);
    if (!validation.valid) {
      setError(validation.reason);
      return;
    }

    if (activeSearchRef.current) return;
    if (retrySecondsRemaining && retrySecondsRemaining > 0) {
      setError(formatRetryCountdown(retrySecondsRemaining));
      return;
    }

    const query = prompt.replace(/\s+/g, " ").trim();
    const sessionId = options?.sessionId ?? workspace.activeId ?? createId("chat");
    const now = new Date().toISOString();
    const userMessage: ChatMessage = { id: createId("user"), role: "user", content: query, createdAt: now };
    const sessionContext = options?.replayAssistantId
      ? undefined
      : buildFmhySessionContext(workspace.sessions.find((session) => session.id === sessionId)?.messages ?? [], query);

    if (!options?.replayAssistantId) {
      setWorkspace((current) => {
        const existing = current.sessions.find(session => session.id === sessionId);
        const session = existing
          ? { ...existing, title: existing.messages.length ? existing.title : titleFromPrompt(query), updatedAt: now, messages: [...existing.messages, userMessage] }
          : { ...createSession(sessionId, new Date(now)), title: titleFromPrompt(query), messages: [userMessage] };
        return { activeId: sessionId, sessions: [session, ...current.sessions.filter(candidate => candidate.id !== sessionId)] };
      });
      setDraft("");
    }
    setError(null);
    setRetryUntil(null);

    const request = { query, requestId: createId("request"), sessionId };
    activeSearchRef.current = request;
    setActiveSearch(request);

    fmhySearch.mutate({ query, context: sessionContext }, {
      onSuccess: (result) => {
        if (!shouldApplyFmhyResult(activeSearchRef.current?.requestId ?? null, request.requestId)) return;
        clearActiveSearch();
        setRetryUntil(null);
        const assistantMessage = messageFromFmhyResult(result, createId("assistant"), new Date().toISOString());
        setWorkspace((current) => ({
          ...current,
          sessions: current.sessions.map(session => session.id === sessionId
            ? {
              ...session,
              updatedAt: assistantMessage.createdAt,
              messages: options?.replayAssistantId
                ? session.messages.map(message => message.id === options.replayAssistantId ? assistantMessage : message)
                : [...session.messages, assistantMessage],
            }
            : session),
        }));
      },
      onError: (requestError) => {
        if (!shouldApplyFmhyResult(activeSearchRef.current?.requestId ?? null, request.requestId)) return;
        clearActiveSearch();
        const message = requestError.message || "The FMHY database is temporarily unavailable. Please try again shortly.";
        const retryAfterSeconds = retryAfterSecondsFromMessage(message);
        setRetryUntil(retryAfterSeconds ? Date.now() + retryAfterSeconds * 1_000 : null);
        setError(retryAfterSeconds ? formatRetryCountdown(retryAfterSeconds) : message);
      },
    });
  }

  function cancelSearch() {
    const cancelledSearch = activeSearchRef.current;
    if (!cancelledSearch) return;
    clearActiveSearch();
    setDraft(cancelledSearch.query);
    setError("Search cancelled. Your question is restored so you can adjust it or try again.");
  }

  function replayAnswer(message: ChatMessage) {
    if (!activeSession) return;
    const prompt = getReplayPrompt(activeSession.messages, message.id);
    if (!prompt) {
      setError("The original question for this answer is unavailable.");
      return;
    }
    submitPrompt(prompt, { replayAssistantId: message.id, sessionId: activeSession.id });
  }

  function deleteSession(id: string) {
    const removedSession = workspace.sessions.find((session) => session.id === id) ?? null;
    if (!removedSession) return;

    if (activeSearchRef.current?.sessionId === id) clearActiveSearch();

    setWorkspace((current) => {
      const sessions = current.sessions.filter((session) => session.id !== id);
      return { activeId: current.activeId === id ? sessions[0]?.id ?? null : current.activeId, sessions };
    });
    setDeletedSession(removedSession);
  }

  function undoDelete() {
    if (!deletedSession) return;
    setWorkspace((current) => restoreDeletedSession(current, deletedSession));
    setDeletedSession(null);
  }

  function copyMessage(message: ChatMessage) {
    void navigator.clipboard?.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1300);
  }

  return (
    <div className="fmhy-app h-dvh overflow-hidden bg-[#f8fafc] text-[#3c3c43] dark:bg-[#1a1a1a] dark:text-[#dfdfd6]">
      <a className="fmhy-skip-link" href="#fmhy-main">Skip to conversation</a>
      <div className="flex h-full overflow-hidden">
        {!sidebarCollapsed ? (
          <div className="hidden lg:flex lg:w-[17.5rem] lg:shrink-0">
            <ChatSidebar
              activeId={workspace.activeId}
              onDelete={deleteSession}
              onNew={startNewSession}
              onSelect={(id) => setWorkspace((current) => ({ ...current, activeId: id }))}
              sessions={visibleSessions}
            />
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="fmhy-topbar">
            <div className="flex min-w-0 items-center gap-2">
              <button aria-label="Open chat history" className="fmhy-icon-button lg:hidden" onClick={() => setSidebarOpen(true)} type="button">
                <Menu className="size-4" />
              </button>
              <button
                aria-label={sidebarCollapsed ? "Show chat history" : "Hide chat history"}
                className="fmhy-icon-button hidden lg:inline-flex"
                onClick={() => setSidebarCollapsed((value) => !value)}
                type="button"
              >
                {sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
              </button>
              {sidebarCollapsed ? <BrandMark /> : <span className="fmhy-topbar-path">Research workspace</span>}
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="hidden items-center gap-1.5 rounded-full border border-[#bce6cd] bg-[#edf9f1] px-2.5 py-1 text-xs font-medium text-[#2d6a58] sm:inline-flex dark:border-[#386752] dark:bg-[#203c32] dark:text-[#a8f0cc]">
                <span className="size-1.5 rounded-full bg-[#2d6a58] dark:bg-[#a8f0cc]" /> FMHY only
              </span>
              <a aria-label="Open FMHY in a new tab" className="fmhy-topbar-link" href="https://fmhy.net" rel="noreferrer" target="_blank">
                <Search className="size-3.5" /> <span className="hidden sm:inline">Browse</span>
              </a>
              <button
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                className="fmhy-icon-button"
                onClick={() => toggleTheme?.()}
                type="button"
              >
                {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </button>
            </div>
          </header>

          <main className="relative flex min-h-0 flex-1 flex-col" id="fmhy-main">
            <div className="min-h-0 flex-1 overflow-y-auto" onScroll={handleConversationScroll} ref={mainScrollRef}>
              {activeSession?.messages.length ? (
                <Conversation messages={activeSession.messages} onCopy={copyMessage} onReplay={isSearching ? undefined : replayAnswer} />
              ) : (
                <EmptyWorkspace onSuggestion={submitPrompt} />
              )}
            </div>
            {showScrollToLatest ? (
              <div className="fmhy-scroll-latest-wrap"><ScrollToLatestButton onClick={scrollToLatestMessage} /></div>
            ) : null}
            {deletedSession ? (
              <div className="fmhy-recovery-banner" role="status">
                Search deleted
                <button className="fmhy-undo-button" onClick={undoDelete} type="button">Undo</button>
              </div>
            ) : null}
            <div className="fmhy-composer-area">
              <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-3 sm:px-7 lg:px-10">
                <ChatComposer availabilityMessage={isSearching ? "Searching the FMHY database…" : "Live FMHY database · Sources included"} error={retrySecondsRemaining ? formatRetryCountdown(retrySecondsRemaining) : error} isSubmitting={isSearching} onCancel={cancelSearch} onChange={setDraft} onSubmit={() => submitPrompt()} retrySecondsRemaining={retrySecondsRemaining} value={draft} />
                <p className="mt-2 text-center text-[11px] text-[#67676c] dark:text-[#98989f]">
                  FMHYchat answers from official FMHY source pages and includes its citation evidence.
                </p>
              </div>
            </div>
          </main>
        </div>
      </div>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Close chat history" className="absolute inset-0 bg-[#0f172a]/30" onClick={() => setSidebarOpen(false)} type="button" />
          <ChatSidebar
            activeId={workspace.activeId}
            isMobile
            onClose={() => setSidebarOpen(false)}
            onDelete={deleteSession}
            onNew={startNewSession}
            onSelect={(id) => {
              setWorkspace((current) => ({ ...current, activeId: id }));
              setSidebarOpen(false);
            }}
            sessions={visibleSessions}
          />
        </div>
      ) : null}

      {copied ? (
        <div className="fmhy-copy-toast" role="status"><Check className="size-3.5" /> Answer copied</div>
      ) : null}
    </div>
  );
}
