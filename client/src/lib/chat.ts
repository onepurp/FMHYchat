export type SourceCitation = {
  label: string;
  href: string;
  resourceHref?: string;
  section: string;
  relevance: "Direct match" | "Related";
  excerpt: string;
  markers?: {
    recommended: boolean;
    thirdPartyIndex: boolean;
    sectionLink: boolean;
  };
};

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  sources?: SourceCitation[];
  resolverVersion?: number;
};

export type ChatSession = {
  id: string;
  title: string;
  updatedAt: string;
  messages: ChatMessage[];
};

export type ChatWorkspace = {
  activeId: string | null;
  sessions: ChatSession[];
};

export type PromptValidation = { valid: true } | { valid: false; reason: string };

export type FmhySearchResult = {
  status: "MATCHED" | "NO_MATCH" | "UNAVAILABLE";
  answer: string;
  sources: SourceCitation[];
};

export type FmhySessionContext = {
  previousQuery: string;
  shownResources: Array<{ label: string; section: string }>;
};

const MAX_SESSION_CONTEXT_RESOURCES = 15;
export const CURRENT_FMHY_RESOLVER_VERSION = 2;

export function isHistoricalFmhyResult(message: ChatMessage) {
  return message.role === "assistant" && message.resolverVersion !== CURRENT_FMHY_RESOLVER_VERSION;
}

export function validateChatPrompt(value: string): PromptValidation {
  const query = value.replace(/\s+/g, " ").trim();
  if (!query) {
    return { valid: false, reason: "Enter a question for FMHYchat." };
  }

  if (query.length > 240) {
    return { valid: false, reason: "Search queries must be 240 characters or fewer." };
  }

  return { valid: true };
}

export function createSession(id: string, now = new Date()): ChatSession {
  return {
    id,
    title: "New FMHY search",
    updatedAt: now.toISOString(),
    messages: [],
  };
}

export function archiveSessions(sessions: ChatSession[]) {
  return sessions.filter((session) => session.messages.length > 0);
}

export function restoreDeletedSession(workspace: ChatWorkspace, session: ChatSession): ChatWorkspace {
  return {
    activeId: session.id,
    sessions: [session, ...workspace.sessions.filter((candidate) => candidate.id !== session.id)],
  };
}

export function getFmhySearchMode() {
  return {
    supportsLiveSearch: true,
    allowsAnswerRegeneration: true,
  };
}

export function getReplayPrompt(messages: ChatMessage[], assistantMessageId: string) {
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId && message.role === "assistant");
  if (assistantIndex < 1) return null;
  return messages.slice(0, assistantIndex).reverse().find((message) => message.role === "user")?.content ?? null;
}

export function shouldApplyFmhyResult(activeRequestId: string | null, resultRequestId: string) {
  return activeRequestId === resultRequestId;
}

function isAdditionalOptionsFollowUp(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase().replace(/[!?.,]+$/, "");
  return [
    "any other options",
    "other options",
    "more options",
    "any alternatives",
    "alternatives",
    "anything else",
    "what else",
    "show me more",
    "more please",
  ].includes(normalized);
}

export function buildFmhySessionContext(messages: ChatMessage[], followUp: string): FmhySessionContext | undefined {
  if (!isAdditionalOptionsFollowUp(followUp)) return undefined;

  const previousQueryIndex = messages
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.role === "user" && !isAdditionalOptionsFollowUp(message.content))?.index;
  if (previousQueryIndex === undefined) return undefined;

  const previousQuery = messages[previousQueryIndex]?.content;
  if (!previousQuery) return undefined;

  const seenResources = new Set<string>();
  const shownResources = messages
    .slice(previousQueryIndex + 1)
    .flatMap((message) => message.role === "assistant" ? message.sources ?? [] : [])
    .flatMap((source) => {
      const label = source.label.replace(/\s+/g, " ").trim().slice(0, 100);
      const section = source.section.replace(/\s+/g, " ").trim().slice(0, 60);
      const identity = label.toLowerCase();
      if (!label || !section || seenResources.has(identity)) return [];
      seenResources.add(identity);
      return [{ label, section }];
    })
    .slice(0, MAX_SESSION_CONTEXT_RESOURCES);

  return { previousQuery: previousQuery.slice(0, 240), shownResources };
}

export function messageFromFmhyResult(result: FmhySearchResult, id: string, createdAt: string): ChatMessage {
  return {
    id,
    role: "assistant",
    content: result.answer,
    createdAt,
    sources: result.status === "UNAVAILABLE" ? [] : result.sources,
    resolverVersion: CURRENT_FMHY_RESOLVER_VERSION,
  };
}

function markdownResourceLink(label: string, href: string) {
  return `[${label.replace(/[\[\]]/g, "\\$&")}](${href})`;
}

function upgradeLegacyAssistantContent(content: string, sources: SourceCitation[] | undefined) {
  const withLinkedResources = [...(sources ?? [])]
    .sort((left, right) => right.label.length - left.label.length)
    .reduce((answer, source) => {
      const href = source.resourceHref ?? source.href;
      const markdownLink = markdownResourceLink(source.label, href);
      return answer.includes(markdownLink) ? answer : answer.split(source.label).join(markdownLink);
    }, content);

  return withLinkedResources.replace(
    /Open the cited FMHY cards below[^.]*\./gi,
    "Each listed title opens its FMHY resource directly.",
  );
}

export function normalizeStoredWorkspace(workspace: ChatWorkspace): ChatWorkspace {
  const sessions = workspace.sessions.map((session) => ({
    ...session,
    messages: session.messages
      .filter(
        (message) => !(
          message.role === "assistant"
          && message.content.startsWith("This static workspace keeps FMHYchat’s source-first interface intact.")
        ),
      )
      .map((message) => message.role === "assistant"
        ? { ...message, content: upgradeLegacyAssistantContent(message.content, message.sources) }
        : message),
  }));

  return {
    activeId: workspace.activeId && sessions.some((session) => session.id === workspace.activeId) ? workspace.activeId : null,
    sessions,
  };
}

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function titleFromPrompt(prompt: string) {
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact.length > 48 ? `${compact.slice(0, 48).trim()}…` : compact;
}
