import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeLLM } from "./llm";

describe("invokeLLM", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses max_completion_tokens for GPT requests so reasoning does not consume the structured response budget", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "response",
      created: 0,
      model: "gpt-5-mini",
      choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await invokeLLM({
      model: "gpt-5-mini",
      maxTokens: 140,
      messages: [{ role: "user", content: "Select a grounded FMHY category." }],
    });

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload).toMatchObject({ max_completion_tokens: 140 });
    expect(payload).not.toHaveProperty("max_tokens");
  });
});
