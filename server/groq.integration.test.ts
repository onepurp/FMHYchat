import { describe, expect, it } from "vitest";
import { invokeGroqChat } from "./groq";

const groqApiKey = process.env.GROQ_API_KEY;

describe.skipIf(!groqApiKey)("configured Groq provider", () => {
  it("authenticates to the model-list endpoint", async () => {
    const response = await fetch("https://api.groq.com/openai/v1/models", {
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
      },
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as { data?: Array<{ id?: string }> };
    expect(body.data?.some(model => typeof model.id === "string" && model.id.length > 0)).toBe(true);
  }, 15_000);

  it("returns a strict bounded page-selection response", async () => {
    const response = await invokeGroqChat({
      model: "openai/gpt-oss-20b",
      maxTokens: 80,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "fmhy_groq_integration_page_selection",
          strict: true,
          schema: {
            type: "object",
            properties: {
              pages: {
                type: "array",
                maxItems: 1,
                items: { type: "string", enum: ["Tools"] },
              },
            },
            required: ["pages"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        { role: "system", content: "Return the supplied page label exactly." },
        { role: "user", content: "Select the FMHY page for an RSS reader from: Tools." },
      ],
    });

    expect(JSON.parse(response.choices[0]?.message?.content ?? "{}")).toEqual({ pages: ["Tools"] });
  }, 20_000);
});
