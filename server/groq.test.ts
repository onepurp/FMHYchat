import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeGroqChat } from "./groq";

describe("Groq server transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("sends a bounded strict-schema request to Groq without exposing the key in an error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"pages":["Tools"]}' } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeGroqChat({
      model: "openai/gpt-oss-20b",
      maxTokens: 80,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "fmhy_grounded_intent_pages",
          strict: true,
          schema: {
            type: "object",
            properties: { pages: { type: "array" } },
            required: ["pages"],
            additionalProperties: false,
          },
        },
      },
      messages: [{ role: "user", content: "Select a page." }],
    });

    expect(result.choices[0]?.message.content).toBe('{"pages":["Tools"]}');
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Bearer /),
          "content-type": "application/json",
        }),
      }),
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "openai/gpt-oss-20b",
      max_completion_tokens: 80,
      temperature: 0,
      reasoning_effort: "low",
      reasoning_format: "hidden",
      response_format: expect.objectContaining({ type: "json_schema" }),
    });
  });

  it("does not include the provider response body in its failure message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "sensitive provider detail" } }),
      { status: 401, headers: { "content-type": "application/json" } },
    )));

    await expect(invokeGroqChat({
      model: "openai/gpt-oss-20b",
      maxTokens: 80,
      messages: [{ role: "user", content: "Select a page." }],
    })).rejects.toThrow("Groq request failed with HTTP 401");
  });

  it("extracts a bounded Retry-After interval from Groq rate limiting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "provider detail must remain private" } }),
      { status: 429, headers: { "retry-after": "17" } },
    )));

    await expect(invokeGroqChat({
      model: "openai/gpt-oss-20b",
      maxTokens: 80,
      messages: [{ role: "user", content: "Select a page." }],
    })).rejects.toMatchObject({
      name: "GroqRateLimitError",
      retryAfterSeconds: 17,
      message: expect.stringMatching(/try again in 17 seconds/i),
    });
  });
});
