export type GroqChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GroqChatRequest = {
  model: string;
  maxTokens: number;
  messages: GroqChatMessage[];
  response_format?: unknown;
};

export type GroqChatResponse = {
  choices: Array<{ message?: { content?: string | null } }>;
};

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_GROQ_RETRY_AFTER_SECONDS = 5;
const MAX_GROQ_RETRY_AFTER_SECONDS = 60;

export class GroqRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Groq is rate limited. Please try again in ${retryAfterSeconds} seconds.`);
    this.name = "GroqRateLimitError";
  }
}

function groqRetryAfterSeconds(value: string | null, now = Date.now()) {
  if (!value) return DEFAULT_GROQ_RETRY_AFTER_SECONDS;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.min(MAX_GROQ_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(seconds)));
  }
  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) return DEFAULT_GROQ_RETRY_AFTER_SECONDS;
  return Math.min(MAX_GROQ_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil((retryAt - now) / 1_000)));
}

export async function invokeGroqChat(params: GroqChatRequest): Promise<GroqChatResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Groq provider is not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GROQ_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        max_completion_tokens: params.maxTokens,
        temperature: 0,
        reasoning_effort: "low",
        reasoning_format: "hidden",
        ...(params.response_format ? { response_format: params.response_format } : {}),
      }),
      redirect: "error",
      signal: controller.signal,
    });

    if (response.status === 429) {
      throw new GroqRateLimitError(groqRetryAfterSeconds(response.headers.get("retry-after")));
    }
    if (!response.ok) throw new Error(`Groq request failed with HTTP ${response.status}`);

    const parsed = await response.json() as GroqChatResponse;
    if (!Array.isArray(parsed.choices)) throw new Error("Groq returned an invalid completion response");
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Groq request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
