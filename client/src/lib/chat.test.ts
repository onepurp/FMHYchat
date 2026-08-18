import { describe, expect, it } from "vitest";
import * as chat from "./chat";

const { createSession, validateChatPrompt } = chat;

describe("validateChatPrompt", () => {
  it("rejects a whitespace-only question", () => {
    expect(validateChatPrompt("   ")).toEqual({ valid: false, reason: "Enter a question for FMHYchat." });
  });

  it("accepts a concise FMHY question", () => {
    expect(validateChatPrompt("Where can I find open-source video tools?")).toEqual({ valid: true });
  });

  it("rejects a query that exceeds the live FMHY 240-character contract before submission", () => {
    expect(validateChatPrompt("a".repeat(241))).toEqual({
      valid: false,
      reason: "Search queries must be 240 characters or fewer.",
    });
  });
});

describe("createSession", () => {
  it("creates a new untitled session with an empty message list", () => {
    const session = createSession("session-1", new Date("2026-08-16T12:00:00.000Z"));

    expect(session).toMatchObject({
      id: "session-1",
      title: "New FMHY search",
      messages: [],
      updatedAt: "2026-08-16T12:00:00.000Z",
    });
  });
});

describe("archive sessions", () => {
  it("omits an empty draft session until the user has submitted a message", () => {
    const archiveSessions = Reflect.get(chat, "archiveSessions") as
      | ((sessions: chat.ChatSession[]) => chat.ChatSession[])
      | undefined;
    const draft = createSession("draft", new Date("2026-08-16T12:00:00.000Z"));
    const searched = {
      ...createSession("searched", new Date("2026-08-16T12:01:00.000Z")),
      messages: [{ id: "user-1", role: "user" as const, content: "Find an ebook library", createdAt: "2026-08-16T12:01:00.000Z" }],
    };

    expect(archiveSessions).toBeTypeOf("function");
    if (!archiveSessions) return;
    expect(archiveSessions([draft, searched])).toEqual([searched]);
  });
});

describe("reversible session deletion", () => {
  it("restores a deleted session as the active conversation", () => {
    const restoreDeletedSession = Reflect.get(chat, "restoreDeletedSession") as
      | ((workspace: chat.ChatWorkspace, session: chat.ChatSession) => chat.ChatWorkspace)
      | undefined;
    const retained = {
      ...createSession("retained", new Date("2026-08-16T12:00:00.000Z")),
      messages: [{ id: "user-1", role: "user" as const, content: "Find films", createdAt: "2026-08-16T12:00:00.000Z" }],
    };
    const removed = {
      ...createSession("removed", new Date("2026-08-16T12:01:00.000Z")),
      messages: [{ id: "user-2", role: "user" as const, content: "Find books", createdAt: "2026-08-16T12:01:00.000Z" }],
    };

    expect(restoreDeletedSession).toBeTypeOf("function");
    if (!restoreDeletedSession) return;
    expect(restoreDeletedSession({ activeId: retained.id, sessions: [retained] }, removed)).toEqual({
      activeId: removed.id,
      sessions: [removed, retained],
    });
  });
});

describe("FMHY live search mode", () => {
  it("enables live FMHY search with FMHY-only answer replay", () => {
    const getFmhySearchMode = Reflect.get(chat, "getFmhySearchMode") as
      | (() => { supportsLiveSearch: boolean; allowsAnswerRegeneration: boolean })
      | undefined;

    expect(getFmhySearchMode).toBeTypeOf("function");
    if (!getFmhySearchMode) return;
    expect(getFmhySearchMode()).toMatchObject({
      supportsLiveSearch: true,
      allowsAnswerRegeneration: true,
    });
  });
});

describe("FMHY query lifecycle", () => {
  it("returns the preceding user query for a completed assistant answer replay", () => {
    const getReplayPrompt = Reflect.get(chat, "getReplayPrompt") as
      | ((messages: chat.ChatMessage[], assistantMessageId: string) => string | null)
      | undefined;
    const messages: chat.ChatMessage[] = [
      { id: "user-1", role: "user", content: "Find an ebook library", createdAt: "2026-08-16T12:00:00.000Z" },
      { id: "assistant-1", role: "assistant", content: "Try a listed resource.", createdAt: "2026-08-16T12:00:01.000Z" },
    ];

    expect(getReplayPrompt).toBeTypeOf("function");
    if (!getReplayPrompt) return;
    expect(getReplayPrompt(messages, "assistant-1")).toBe("Find an ebook library");
  });

  it("rejects a cancelled or superseded FMHY result token before it reaches local history", () => {
    const shouldApplyFmhyResult = Reflect.get(chat, "shouldApplyFmhyResult") as
      | ((activeRequestId: string | null, resultRequestId: string) => boolean)
      | undefined;

    expect(shouldApplyFmhyResult).toBeTypeOf("function");
    if (!shouldApplyFmhyResult) return;
    expect(shouldApplyFmhyResult("request-current", "request-current")).toBe(true);
    expect(shouldApplyFmhyResult("request-current", "request-cancelled")).toBe(false);
    expect(shouldApplyFmhyResult(null, "request-current")).toBe(false);
  });

  it("derives bounded FMHY context for an additional-options follow-up from the same completed session", () => {
    const buildFmhySessionContext = Reflect.get(chat, "buildFmhySessionContext") as
      | ((messages: chat.ChatMessage[], followUp: string) => unknown)
      | undefined;
    const messages: chat.ChatMessage[] = [
      { id: "user-1", role: "user", content: "What are the recommended music tools?", createdAt: "2026-08-17T09:00:00.000Z" },
      {
        id: "assistant-1",
        role: "assistant",
        content: "I would start with two FMHY resources.",
        createdAt: "2026-08-17T09:00:01.000Z",
        sources: [
          { label: "AudioMass", href: "https://fmhy.net/audio", section: "Audio", relevance: "Direct match", excerpt: "Browser audio editor" },
          { label: "MusicBrainz", href: "https://fmhy.net/audio", section: "Audio", relevance: "Related", excerpt: "Music metadata" },
        ],
      },
    ];

    expect(buildFmhySessionContext).toBeTypeOf("function");
    if (!buildFmhySessionContext) return;
    expect(buildFmhySessionContext(messages, "any other options?")).toEqual({
      previousQuery: "What are the recommended music tools?",
      shownResources: [
        { label: "AudioMass", section: "Audio" },
        { label: "MusicBrainz", section: "Audio" },
      ],
    });
  });

  it("keeps a specific new request independent even when it contains a broad follow-up word", () => {
    const buildFmhySessionContext = Reflect.get(chat, "buildFmhySessionContext") as
      | ((messages: chat.ChatMessage[], followUp: string) => unknown)
      | undefined;
    const messages: chat.ChatMessage[] = [
      { id: "user-1", role: "user", content: "What are the recommended music tools?", createdAt: "2026-08-17T09:00:00.000Z" },
      {
        id: "assistant-1",
        role: "assistant",
        content: "I would start with two FMHY resources.",
        createdAt: "2026-08-17T09:00:01.000Z",
        sources: [{ label: "AudioMass", href: "https://fmhy.net/audio", section: "Audio", relevance: "Direct match", excerpt: "Browser audio editor" }],
      },
    ];

    expect(buildFmhySessionContext).toBeTypeOf("function");
    if (!buildFmhySessionContext) return;
    expect(buildFmhySessionContext(messages, "more open-source music production tools")).toBeUndefined();
  });

  it("retains the original topic and accumulated FMHY resources across consecutive generic follow-ups", () => {
    const buildFmhySessionContext = Reflect.get(chat, "buildFmhySessionContext") as
      | ((messages: chat.ChatMessage[], followUp: string) => unknown)
      | undefined;
    const messages: chat.ChatMessage[] = [
      { id: "user-1", role: "user", content: "What are the recommended music tools?", createdAt: "2026-08-17T09:00:00.000Z" },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Start with AudioMass.",
        createdAt: "2026-08-17T09:00:01.000Z",
        sources: [{ label: "AudioMass", href: "https://fmhy.net/audio", section: "Audio", relevance: "Direct match", excerpt: "Browser audio editor" }],
      },
      { id: "user-2", role: "user", content: "any other options?", createdAt: "2026-08-17T09:01:00.000Z" },
      {
        id: "assistant-2",
        role: "assistant",
        content: "Try MusicBrainz next.",
        createdAt: "2026-08-17T09:01:01.000Z",
        sources: [{ label: "MusicBrainz", href: "https://fmhy.net/audio", section: "Audio", relevance: "Direct match", excerpt: "Music metadata" }],
      },
    ];

    expect(buildFmhySessionContext).toBeTypeOf("function");
    if (!buildFmhySessionContext) return;
    expect(buildFmhySessionContext(messages, "anything else?")).toEqual({
      previousQuery: "What are the recommended music tools?",
      shownResources: [
        { label: "AudioMass", section: "Audio" },
        { label: "MusicBrainz", section: "Audio" },
      ],
    });
  });

  it("retains two complete source batches so a second generic follow-up can exclude recent results", () => {
    const buildFmhySessionContext = Reflect.get(chat, "buildFmhySessionContext") as
      | ((messages: chat.ChatMessage[], followUp: string) => chat.FmhySessionContext | undefined)
      | undefined;
    const sources = [
      "AudioMass",
      "MusicBrainz",
      "Soundation",
      "BandLab",
      "Cakewalk",
      "GarageBand",
      "LMMS",
    ].map((label) => ({ label, href: "https://fmhy.net/audio", section: "Audio", relevance: "Related" as const, excerpt: "Music tool" }));
    const messages: chat.ChatMessage[] = [
      { id: "user-1", role: "user", content: "What are the recommended music tools?", createdAt: "2026-08-17T09:00:00.000Z" },
      { id: "assistant-1", role: "assistant", content: "First results.", createdAt: "2026-08-17T09:00:01.000Z", sources: sources.slice(0, 5) },
      { id: "user-2", role: "user", content: "any other options?", createdAt: "2026-08-17T09:01:00.000Z" },
      { id: "assistant-2", role: "assistant", content: "More results.", createdAt: "2026-08-17T09:01:01.000Z", sources: sources.slice(5) },
    ];

    expect(buildFmhySessionContext).toBeTypeOf("function");
    if (!buildFmhySessionContext) return;
    expect(buildFmhySessionContext(messages, "anything else?")?.shownResources.map((resource) => resource.label)).toEqual([
      "AudioMass",
      "MusicBrainz",
      "Soundation",
      "BandLab",
      "Cakewalk",
      "GarageBand",
      "LMMS",
    ]);
  });
});

describe("FMHY unavailable response", () => {
  it("creates a plain assistant message without citation cards when FMHY is unreachable", () => {
    const messageFromFmhyResult = Reflect.get(chat, "messageFromFmhyResult") as
      | ((result: { status: "UNAVAILABLE"; answer: string; sources: chat.SourceCitation[] }, id: string, createdAt: string) => chat.ChatMessage)
      | undefined;

    expect(messageFromFmhyResult).toBeTypeOf("function");
    if (!messageFromFmhyResult) return;

    expect(messageFromFmhyResult({
      status: "UNAVAILABLE",
      answer: "The official FMHY source pages could not be reached right now.",
      sources: [],
    }, "assistant-1", "2026-08-16T12:00:00.000Z")).toEqual({
      id: "assistant-1",
      role: "assistant",
      content: "The official FMHY source pages could not be reached right now.",
      createdAt: "2026-08-16T12:00:00.000Z",
      sources: [],
      resolverVersion: 2,
    });
  });
});

describe("historical FMHY results", () => {
  it("distinguishes unversioned saved assistant answers from results created by the current resolver", () => {
    const isHistoricalFmhyResult = Reflect.get(chat, "isHistoricalFmhyResult") as
      | ((message: chat.ChatMessage) => boolean)
      | undefined;

    expect(isHistoricalFmhyResult).toBeTypeOf("function");
    if (!isHistoricalFmhyResult) return;

    expect(isHistoricalFmhyResult({
      id: "legacy-answer",
      role: "assistant",
      content: "An earlier saved answer.",
      createdAt: "2026-08-16T12:00:00.000Z",
    })).toBe(true);
    expect(isHistoricalFmhyResult({
      id: "current-answer",
      role: "assistant",
      content: "A current grounded answer.",
      createdAt: "2026-08-17T12:00:00.000Z",
      resolverVersion: 2,
    })).toBe(false);
  });
});

describe("stored workspace migration", () => {
  it("removes legacy simulated assistant answers while retaining the user’s question", () => {
    const normalizeStoredWorkspace = Reflect.get(chat, "normalizeStoredWorkspace") as
      | ((workspace: chat.ChatWorkspace) => chat.ChatWorkspace)
      | undefined;
    const workspace: chat.ChatWorkspace = {
      activeId: "session-1",
      sessions: [{
        ...createSession("session-1", new Date("2026-08-16T12:00:00.000Z")),
        messages: [
          { id: "user-1", role: "user", content: "Find an ebook library", createdAt: "2026-08-16T12:00:00.000Z" },
          {
            id: "assistant-1",
            role: "assistant",
            content: "This static workspace keeps FMHYchat’s source-first interface intact. Reconnect the original FMHY-backed chat route to return live database results; every production answer should include its FMHY source below.",
            createdAt: "2026-08-16T12:00:01.000Z",
          },
        ],
      }],
    };

    expect(normalizeStoredWorkspace).toBeTypeOf("function");
    if (!normalizeStoredWorkspace) return;
    expect(normalizeStoredWorkspace(workspace).sessions[0].messages).toEqual([
      { id: "user-1", role: "user", content: "Find an ebook library", createdAt: "2026-08-16T12:00:00.000Z" },
    ]);
  });

  it("upgrades saved FMHY answers with retained citations into clickable resource Markdown and current source-row wording", () => {
    const normalizeStoredWorkspace = Reflect.get(chat, "normalizeStoredWorkspace") as
      | ((workspace: chat.ChatWorkspace) => chat.ChatWorkspace)
      | undefined;
    const workspace: chat.ChatWorkspace = {
      activeId: "session-2",
      sessions: [{
        ...createSession("session-2", new Date("2026-08-16T12:00:00.000Z")),
        messages: [{
          id: "assistant-legacy",
          role: "assistant",
          content: "FMHY lists Audio Library as relevant. Open the cited FMHY cards below to review the source.",
          createdAt: "2026-08-16T12:00:00.000Z",
          sources: [{
            label: "Audio Library",
            href: "https://fmhy.net/reading",
            resourceHref: "https://example.com/audio-library",
            section: "Reading",
            relevance: "Direct match",
            excerpt: "Audiobooks",
          }],
        }],
      }],
    };

    expect(normalizeStoredWorkspace).toBeTypeOf("function");
    if (!normalizeStoredWorkspace) return;
    expect(normalizeStoredWorkspace(workspace).sessions[0]?.messages[0]?.content).toBe(
      "FMHY lists [Audio Library](https://example.com/audio-library) as relevant. Each listed title opens its FMHY resource directly.",
    );
  });
});
