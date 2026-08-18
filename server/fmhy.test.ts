import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearFmhySourceCacheForTest,
  FMHY_SOURCE_FETCH_TIMEOUT_MS,
  extractFmhyResources,
  formatFmhyAnswer,
  linkFmhyResourceTitles,
  normalizeFmhyQuery,
  prepareFmhySearchRequest,
  rankFmhyResources,
  searchFmhy,
  selectFmhyPages,
} from "./fmhy";
import { invokeLLM } from "./_core/llm";
import { invokeGroqChat } from "./groq";

const { invokeModel, sharedStateMock, sharedStateRequiredMock } = vi.hoisted(() => ({
  invokeModel: vi.fn(),
  sharedStateRequiredMock: vi.fn(() => false),
  sharedStateMock: {
    readFreshSourceCache: vi.fn(),
    claimSourceRefresh: vi.fn(),
    writeSourceCache: vi.fn(),
    releaseSourceRefresh: vi.fn(),
  },
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: invokeModel,
}));

vi.mock("./groq", () => ({
  invokeGroqChat: invokeModel,
}));

vi.mock("./fmhySharedState", () => ({
  fmhySharedState: sharedStateMock,
  sharedFmhyStateRequired: sharedStateRequiredMock,
}));

const readingPage = {
  key: "reading",
  label: "Reading",
  url: "https://fmhy.net/reading",
};

describe("FMHY retrieval boundary", () => {
  afterEach(() => {
    clearFmhySourceCacheForTest();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
    sharedStateRequiredMock.mockReturnValue(false);
  });

  it("normalizes a valid query and rejects an empty or overlong request", () => {
    expect(normalizeFmhyQuery("  free   audiobook library ")).toBe("free audiobook library");
    expect(() => normalizeFmhyQuery(" ")).toThrow("valid search query");
    expect(() => normalizeFmhyQuery("x".repeat(241))).toThrow("240 characters");
  });

  it("allows a bounded window for slow but reachable official FMHY pages", () => {
    expect(FMHY_SOURCE_FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(20_000);
    expect(FMHY_SOURCE_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it("selects only relevant official FMHY category pages", () => {
    const pages = selectFmhyPages("Where can I find audiobook libraries?");

    expect(pages.some(page => page.key === "reading")).toBe(true);
    expect(pages.every(page => page.url.startsWith("https://fmhy.net/"))).toBe(true);
    expect(pages).toHaveLength(2);
  });

  it("extracts safe resources from FMHY markup and rejects unsafe URL schemes", () => {
    const resources = extractFmhyResources(
      `
        <ul>
          <li><a href="https://archive.org/details/texts">Internet Archive</a> - Books / Audiobooks / Magazines</li>
          <li><a href="javascript:alert(1)">Unsafe result</a> - Audiobooks</li>
        </ul>
      `,
      readingPage,
    );

    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({
      title: "Internet Archive",
      resourceUrl: "https://archive.org/details/texts",
      section: "Reading",
      sourceUrl: "https://fmhy.net/reading",
    });
  });

  it("preserves an official FMHY heading as context for resources beneath it", () => {
    const resources = extractFmhyResources(
      `
        <h3 id="food">Food <a class="header-anchor" href="#food">​</a></h3>
        <ul><li><a href="https://example.com/meal-planner">Meal Planner</a> - Plan meals for the week</li></ul>
      `,
      readingPage,
    );

    expect(resources[0]).toMatchObject({
      title: "Meal Planner",
      section: "Reading · Food",
    });
  });

  it("preserves verified FMHY recommendation, index, and section markers from an official list item", () => {
    const resources = extractFmhyResources(
      `<li>⭐ 🌐 ↪️ <strong><a href="https://example.com/library">Featured Library</a></strong> - A curated collection</li>`,
      readingPage,
    );

    expect(resources[0]).toMatchObject({
      title: "Featured Library",
      markers: {
        recommended: true,
        thirdPartyIndex: true,
        sectionLink: true,
      },
    });
  });

  it("does not label an ordinary FMHY resource as a section link when it has no ↪️ marker", () => {
    const resources = extractFmhyResources(
      `<li><a href="https://example.com/library">Ordinary Library</a> - A curated collection</li>`,
      readingPage,
    );

    expect(resources[0]?.markers.sectionLink).toBe(false);
  });

  it("ranks matches by source text and never fabricates a nonmatching result", () => {
    const resources = extractFmhyResources(
      `
        <ul>
          <li><a href="https://example.com/books">Open Books</a> - Ebooks and audiobooks</li>
          <li><a href="https://example.com/music">Open Music</a> - Music discovery</li>
          <li><a href="https://example.com/repository">MSU Digital Repository</a> - University collections</li>
        </ul>
      `,
      readingPage,
    );

    expect(rankFmhyResources(resources, "audiobook library").map(item => item.title)).toEqual(["Open Books"]);
    expect(rankFmhyResources(resources, "planetary geology")).toEqual([]);
    expect(rankFmhyResources(resources, "xylophone astrophysics repository")).toEqual([]);
  });

  it("suppresses lexical near-matches when a multi-term query has a strong direct match", () => {
    const resources = extractFmhyResources(
      `
        <ul>
          <li><a href="https://example.com/rss">RSS Readers</a> - Follow RSS feeds</li>
          <li><a href="https://example.com/annas">Anna's Archive Reader</a> - Read Anna's Archive files</li>
          <li><a href="https://example.com/anx">Anx Reader</a> - A reading app</li>
        </ul>
      `,
      readingPage,
    );

    expect(rankFmhyResources(resources, "I want an rss reader").map(item => item.title)).toEqual(["RSS Readers"]);
  });

  it("rejects conversational-word and prefix overlaps when no FMHY resource matches the requested concept", () => {
    const resources = extractFmhyResources(
      `
        <ul>
          <li><a href="https://example.com/what-beats-rock">WhatBeatsRock</a> - Guess What Beats What</li>
          <li><a href="https://example.com/this-to-that">ThistoThat</a> - How to Glue Anything to Anything</li>
          <li><a href="https://example.com/drinkable">Drinkable</a> - Create Cocktails From Home Ingredients</li>
        </ul>
      `,
      readingPage,
    );

    expect(rankFmhyResources(
      resources,
      "I want to know what to cock and eat, any website that gives recommendations?",
    )).toEqual([]);
  });

  it("keeps the reported food-recommendation request inside the selected FMHY Food heading", async () => {
    const foodMarkup = `
      <h3 id="food">Food <a class="header-anchor" href="#food">​</a></h3>
      <ul>
        <li><a href="https://example.com/eat-this-much">Eat This Much</a> - Automatic meal planning and recipe recommendations</li>
        <li><a href="https://example.com/eat-the-fruit">EatTheFruit</a> - Find recipes from ingredients and meal ideas</li>
        <li><a href="https://example.com/still-tasty">Still Tasty</a> - Food storage and meal preparation guidance</li>
      </ul>
      <h3 id="games">Games <a class="header-anchor" href="#games">​</a></h3>
      <ul>
        <li><a href="https://example.com/what-beats-rock">WhatBeatsRock</a> - Guess What Beats What</li>
        <li><a href="https://example.com/this-to-that">ThistoThat</a> - How to Glue Anything to Anything</li>
        <li><a href="https://example.com/drinkable">Drinkable</a> - Create Cocktails From Home Ingredients</li>
      </ul>
    `;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(foodMarkup, { status: 200 })));
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Reading"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ sections: ["Reading · Food"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ answer: "Eat This Much is a helpful meal-planning start." }) } }] } as never);

    const response = await searchFmhy("I want to know what to cook and eat, any website that gives recommendations?");

    expect(response.status).toBe("MATCHED");
    expect(response.sources.map(source => source.label)).toEqual([
      "Eat This Much",
      "EatTheFruit",
      "Still Tasty",
    ]);
    expect(response.sources.every(source => source.section === "Reading · Food")).toBe(true);
  });

  it("retains a valid FMHY result when a recommendation request contains a meaningful resource concept", () => {
    const resources = extractFmhyResources(
      `
        <ul>
          <li><a href="https://example.com/audio-library">Audio Library</a> - Audiobooks and spoken-word resources</li>
          <li><a href="https://example.com/music">Music Site</a> - Music discovery</li>
        </ul>
      `,
      readingPage,
    );

    expect(rankFmhyResources(
      resources,
      "Can you recommend a website for audiobook resources?",
    ).map(item => item.title)).toEqual(["Audio Library"]);
  });

  it("uses deterministic resources only from the LLM-selected FMHY heading when a descriptive request has no literal match", async () => {
    const officialFmhyMarkup = `
      <ul>
        <li><a href="https://example.com/meal-planner">Meal Planner</a> - Plan meals and recipes for the week</li>
      </ul>
    `;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(officialFmhyMarkup, { status: 200 })));
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Reading"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ sections: ["Reading"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ answer: "Meal Planner helps with weekly meals." }) } }] } as never);

    const response = await searchFmhy("I need help making decisions about my dinner routine.");

    expect(response).toMatchObject({
      status: "MATCHED",
      sources: [expect.objectContaining({ label: "Meal Planner", relevance: "Direct match" })],
    });
    expect(invokeLLM).toHaveBeenCalledTimes(3);
  });

  it("expands the grounded catalog to other official FMHY pages when the descriptive request has no category keyword", async () => {
    const videoMarkup = `
      <ul>
        <li><a href="https://example.com/cinema-guide">Cinema Guide</a> - Curated films and viewing guides</li>
      </ul>
    `;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(
      url === "https://fmhy.net/video" ? videoMarkup : "<ul></ul>",
      { status: 200 },
    ))));
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Video"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ sections: ["Video"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ answer: "Cinema Guide is a viewing guide." }) } }] } as never);

    const response = await searchFmhy("I want a place for stories told through moving images.");

    expect(response).toMatchObject({
      status: "MATCHED",
      sources: [expect.objectContaining({ label: "Cinema Guide", relevance: "Direct match" })],
    });
  });

  it("keeps a relevant FMHY candidate available when many unrelated records precede it", async () => {
    const readingMarkup = `<h3>Books</h3><ul>${Array.from({ length: 121 }, (_, index) => `<li><a href="https://example.com/book-${index}">Book ${index}</a> - Reading catalog</li>`).join("")}</ul><h3>Food</h3><ul><li><a href="https://example.com/meal-planner">Meal Planner</a> - Plan meals and recipes for the week</li></ul>`;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(
      url === "https://fmhy.net/reading" ? readingMarkup : "<ul></ul>",
      { status: 200 },
    ))));
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Reading"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ sections: ["Reading · Food"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ answer: "Meal Planner helps with dinner planning." }) } }] } as never);

    const response = await searchFmhy("I need help deciding what to prepare for dinner each evening.");

    expect(response).toMatchObject({
      status: "MATCHED",
      sources: [expect.objectContaining({ label: "Meal Planner", relevance: "Direct match" })],
    });
  });

  it("falls back to the local official-source cache when the production shared cache is unavailable", async () => {
    const readingMarkup = `<h3>Food</h3><ul><li><a href="https://example.com/meal-planner">Meal Planner</a> - Plan meals and recipes for the week</li></ul>`;
    sharedStateRequiredMock.mockReturnValue(true);
    sharedStateMock.readFreshSourceCache.mockRejectedValue(new Error("database offline"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(readingMarkup, { status: 200 })));
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Reading"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ sections: ["Reading · Food"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ answer: "Meal Planner helps with dinner planning." }) } }] } as never);

    await expect(searchFmhy("I need help deciding what to prepare for dinner.")).resolves.toMatchObject({
      status: "MATCHED",
      sources: [expect.objectContaining({ label: "Meal Planner" })],
    });
    expect(fetch).toHaveBeenCalledWith("https://fmhy.net/reading", expect.any(Object));
  });

  it("selects an official FMHY heading before resolving a descriptive resource", async () => {
    const miscMarkup = `
      <h3 id="food">Food <a class="header-anchor" href="#food">​</a></h3>
      <ul><li><a href="https://example.com/meal-planner">Meal Planner</a> - Plan meals and recipes for the week</li></ul>
      <h3 id="games">Games <a class="header-anchor" href="#games">​</a></h3>
      <ul><li><a href="https://example.com/puzzle">Puzzle Site</a> - Play puzzles</li></ul>
    `;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(miscMarkup, { status: 200 })));
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Reading"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ sections: ["Reading · Food"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ answer: "Meal Planner helps with dinner planning." }) } }] } as never);

    const response = await searchFmhy("I need help deciding what to prepare for dinner each evening.");

    expect(response).toMatchObject({
      status: "MATCHED",
      sources: [expect.objectContaining({ label: "Meal Planner", relevance: "Direct match" })],
    });
    expect(invokeLLM).toHaveBeenCalledTimes(3);
    const headingPrompt = vi.mocked(invokeLLM).mock.calls[1]?.[0]?.messages[1]?.content ?? "";
    expect(headingPrompt).toContain("officialFmhySections");
    expect(headingPrompt).toContain('"Food"');
    expect(headingPrompt).toContain("Meal Planner");
    expect(headingPrompt).toContain("Plan meals and recipes for the week");
    expect(headingPrompt).not.toContain("Reading · Food");
  });

  it("selects an official FMHY page before its heading and resource record", async () => {
    const miscMarkup = `
      <h3 id="food">Food <a class="header-anchor" href="#food">​</a></h3>
      <ul><li><a href="https://example.com/meal-planner">Meal Planner</a> - Plan meals and recipes for the week</li></ul>
    `;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(miscMarkup, { status: 200 })));
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Reading"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ sections: ["Reading · Food"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ answer: "Meal Planner helps with dinner planning." }) } }] } as never);

    const response = await searchFmhy("I need help deciding what to prepare for dinner each evening.");

    expect(response).toMatchObject({
      status: "MATCHED",
      sources: [expect.objectContaining({ label: "Meal Planner", relevance: "Direct match" })],
    });
    expect(invokeLLM).toHaveBeenCalledTimes(3);
    expect(vi.mocked(invokeLLM).mock.calls[0]?.[0]?.messages[1]?.content).toContain("officialFmhyPages");
    expect(vi.mocked(invokeLLM).mock.calls[0]?.[0]?.maxTokens).toBe(256);
    expect(vi.mocked(invokeLLM).mock.calls[1]?.[0]?.maxTokens).toBe(256);
    expect(vi.mocked(invokeGroqChat).mock.calls[0]?.[0]?.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        strict: true,
        schema: {
          properties: {
            pages: { items: { enum: expect.arrayContaining(["Reading"]) } },
          },
        },
      },
    });
    expect(vi.mocked(invokeGroqChat).mock.calls[1]?.[0]?.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        strict: true,
        schema: {
          properties: {
            sections: { items: { enum: expect.arrayContaining(["Food"]) } },
          },
        },
      },
    });
    const headingInstruction = vi.mocked(invokeGroqChat).mock.calls[1]?.[0]?.messages[0]?.content ?? "";
    expect(headingInstruction).toContain("Select one label");
    expect(headingInstruction).not.toContain("at most three labels");
  });

  it("keeps the official Food topic visible in the page catalog when it would be skipped by small alphabetical sampling", async () => {
    const headings = [
      "Albums", "Books", "Cinema", "Directories", "Food", "Games", "Health", "Images", "Journals", "Knowledge",
      "Learning", "Maps", "News", "Operating Systems", "Podcasts", "Quotes", "Recipes", "Software", "Travel", "Writing",
    ];
    const markup = headings.map((heading) => `
      <h3 id="${heading.toLowerCase().replace(/\s+/g, "-")}">${heading}</h3>
      <ul><li><a href="https://example.com/${heading.toLowerCase().replace(/\s+/g, "-")}">${heading} Resource</a> - ${heading} reference</li></ul>
    `).join("");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(markup, { status: 200 })));
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Reading"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ sections: ["Reading · Food"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ answer: "Food Resource helps with dinner planning." }) } }] } as never);

    await searchFmhy("I need help deciding what to prepare for dinner.");

    const pagePrompt = vi.mocked(invokeGroqChat).mock.calls[0]?.[0]?.messages[1]?.content ?? "";
    expect(pagePrompt).toContain('"Food"');
  });

  it("retries a failed semantic page selection once with the supported Groq fallback model", async () => {
    const rssMarkup = `
      <h3 id="rss-readers">RSS Readers <a class="header-anchor" href="#rss-readers">​</a></h3>
      <ul><li><a href="https://example.com/rss-reader">RSS Reader</a> - Read feeds in one place</li></ul>
    `;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(
      url === "https://fmhy.net/internet-tools" ? rssMarkup : "<ul></ul>",
      { status: 200 },
    ))));
    vi.mocked(invokeLLM)
      .mockRejectedValueOnce(new Error("primary selector unavailable"))
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Tools"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ sections: ["Tools · RSS Readers"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ answer: "RSS Reader collects feeds." }) } }] } as never);

    const response = await searchFmhy("I want an rss reader");

    expect(response).toMatchObject({
      status: "MATCHED",
      sources: [expect.objectContaining({ label: "RSS Reader", section: "Tools · RSS Readers" })],
    });
    expect(vi.mocked(invokeGroqChat).mock.calls.slice(0, 2).map(([params]) => params.model)).toEqual([
      "openai/gpt-oss-20b",
      "openai/gpt-oss-120b",
    ]);
  });

  it("does not retry a semantic selector after account-wide usage exhaustion", async () => {
    const rssMarkup = `
      <h3 id="rss-readers">RSS Readers <a class="header-anchor" href="#rss-readers">​</a></h3>
      <ul><li><a href="https://example.com/rss-reader">RSS Reader</a> - Read feeds in one place</li></ul>
    `;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(
      url === "https://fmhy.net/internet-tools" ? rssMarkup : "<ul></ul>",
      { status: 200 },
    ))));
    vi.mocked(invokeLLM).mockRejectedValueOnce(new Error("LLM invoke failed: 412 Precondition Failed – your account has hit a usage exhausted"));

    const response = await searchFmhy("I want an rss reader");

    expect(response).toMatchObject({ status: "UNAVAILABLE", sources: [] });
    expect(vi.mocked(invokeLLM)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(invokeGroqChat).mock.calls[0]?.[0]?.model).toBe("openai/gpt-oss-20b");
  });

  it("does not bypass grounded intent selection when a direct query has a literal FMHY match", async () => {
    const rssMarkup = `
      <h3 id="rss-readers">RSS Readers <a class="header-anchor" href="#rss-readers">​</a></h3>
      <ul><li><a href="https://example.com/rss-reader">RSS Reader</a> - Read feeds in one place</li></ul>
    `;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(rssMarkup, { status: 200 })));
    vi.mocked(invokeLLM).mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ sections: [] }) } }],
    } as never);

    const response = await searchFmhy("I want an rss reader");

    expect(response).toMatchObject({
      status: "NO_MATCH",
      sources: [],
    });
  });

  it("recovers a malformed heading-selection payload only when it names a supplied official FMHY heading", async () => {
    const rssMarkup = `
      <h3 id="rss-readers">RSS Readers <a class="header-anchor" href="#rss-readers">​</a></h3>
      <ul><li><a href="https://example.com/rss-reader">RSS Reader</a> - Read feeds in one place</li></ul>
    `;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(rssMarkup, { status: 200 })));
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Reading"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: `{"sections":["Reading · Invented','Reading · RSS Readers"]}` } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ answer: "RSS Reader collects feeds." }) } }] } as never);

    const response = await searchFmhy("I want an rss reader");

    expect(response).toMatchObject({
      status: "MATCHED",
      sources: [expect.objectContaining({ label: "RSS Reader", relevance: "Direct match" })],
    });
  });

  it("retrieves RSS resources through FMHY’s canonical Internet Tools page", async () => {
    const rssMarkup = `
      <h3 id="rss-readers">RSS Readers <a class="header-anchor" href="#rss-readers">​</a></h3>
      <ul><li><a href="https://example.com/rss-reader">RSS Reader</a> - Read feeds in one place</li></ul>
    `;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(
      url === "https://fmhy.net/internet-tools" ? rssMarkup : "<ul></ul>",
      { status: 200 },
    ))));
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Tools"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ sections: ["Tools · RSS Readers"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ answer: "RSS Reader collects feeds." }) } }] } as never);

    const response = await searchFmhy("I want an rss reader");

    expect(response).toMatchObject({
      status: "MATCHED",
      sources: [expect.objectContaining({
        label: "RSS Reader",
        section: "Tools · RSS Readers",
        href: "https://fmhy.net/internet-tools",
      })],
    });
    expect(fetch).toHaveBeenCalledWith("https://fmhy.net/internet-tools", expect.any(Object));
  });

  it("falls back to canonical FMHY provenance when a generated RSS summary names a conflicting category", async () => {
    const rssMarkup = `
      <h3 id="rss-readers">RSS Readers <a class="header-anchor" href="#rss-readers">​</a></h3>
      <ul><li><a href="https://example.com/rss-reader">RSS Reader</a> - Read feeds in one place</li></ul>
    `;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(
      url === "https://fmhy.net/internet-tools" ? rssMarkup : "<ul></ul>",
      { status: 200 },
    ))));
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Tools"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ sections: ["Tools · RSS Readers"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ answer: "RSS Reader is listed in FMHY’s Miscellaneous section." }) } }] } as never);

    const response = await searchFmhy("I want an rss reader");

    expect(response.answer).not.toContain("Miscellaneous");
    expect(response.answer).toContain("FMHY describes it as Read feeds in one place.");
    expect(response.sources[0]).toMatchObject({
      href: "https://fmhy.net/internet-tools",
      section: "Tools · RSS Readers",
    });
  });

  it.each([
    "RSS Reader is listed in the Miscellaneous section.",
    "RSS Reader can be found under Miscellaneous.",
  ])("rejects an unprefixed conflicting RSS category claim: %s", async (answer) => {
    const rssMarkup = `
      <h3 id="rss-readers">RSS Readers <a class="header-anchor" href="#rss-readers">​</a></h3>
      <ul><li><a href="https://example.com/rss-reader">RSS Reader</a> - Read feeds in one place</li></ul>
    `;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(
      url === "https://fmhy.net/internet-tools" ? rssMarkup : "<ul></ul>",
      { status: 200 },
    ))));
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Tools"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ sections: ["Tools · RSS Readers"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ answer }) } }] } as never);

    const response = await searchFmhy("I want an rss reader");

    expect(response.answer).not.toContain("Miscellaneous");
    expect(response.answer).toContain("FMHY describes it as Read feeds in one place.");
  });

  it("retains a generated RSS summary that names its canonical Tools category", async () => {
    const rssMarkup = `
      <h3 id="rss-readers">RSS Readers <a class="header-anchor" href="#rss-readers">​</a></h3>
      <ul><li><a href="https://example.com/rss-reader">RSS Reader</a> - Read feeds in one place</li></ul>
    `;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(
      url === "https://fmhy.net/internet-tools" ? rssMarkup : "<ul></ul>",
      { status: 200 },
    ))));
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Tools"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ sections: ["Tools · RSS Readers"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ answer: "RSS Reader is listed in the Tools section." }) } }] } as never);

    const response = await searchFmhy("I want an rss reader");

    expect(response.answer).toContain("[RSS Reader](https://example.com/rss-reader) is listed in the Tools section.");
  });

  it("keeps lower-scoring alternatives that match multiple meaningful query terms", () => {
    const resources = extractFmhyResources(
      `
        <ul>
          <li><a href="https://example.com/private-browser">Private Browser</a> - A privacy-first browser</li>
          <li><a href="https://example.com/privacy-guide">Privacy Browser Guide</a> - Browser privacy guidance</li>
          <li><a href="https://example.com/browser-directory">Browser Directory</a> - A list of browsers</li>
        </ul>
      `,
      readingPage,
    );

    expect(rankFmhyResources(resources, "privacy browser").map(item => item.title)).toEqual([
      "Privacy Browser Guide",
      "Private Browser",
    ]);
  });

  it("keeps single-term searches permissive", () => {
    const resources = extractFmhyResources(
      `
        <ul>
          <li><a href="https://example.com/rss">RSS Readers</a> - Follow RSS feeds</li>
          <li><a href="https://example.com/annas">Anna's Archive Reader</a> - Read Anna's Archive files</li>
          <li><a href="https://example.com/anx">Anx Reader</a> - A reading app</li>
        </ul>
      `,
      readingPage,
    );

    expect(rankFmhyResources(resources, "reader").map(item => item.title)).toEqual([
      "Anna's Archive Reader",
      "Anx Reader",
      "RSS Readers",
    ]);
  });

  it("retains every result that matches multiple meaningful terms of a specific query", () => {
    const resources = extractFmhyResources(
      `
        <ul>
          <li><a href="https://example.com/notepad">Open Source Note App</a> - A notes application</li>
          <li><a href="https://example.com/notetool">Open Note Tool</a> - A source-available note utility</li>
          <li><a href="https://example.com/source-notes">Source Notes</a> - Open note-taking software</li>
        </ul>
      `,
      readingPage,
    );

    expect(rankFmhyResources(resources, "open source note app").map(item => item.title)).toEqual([
      "Open Source Note App",
      "Open Note Tool",
      "Source Notes",
    ]);
  });

  it("formats deterministic fallback answers with a safe Markdown link for each mentioned FMHY resource", () => {
    const resources = extractFmhyResources(
      `<li><a href="https://example.com/audiobooks">Audio Library</a> - Audiobooks</li>`,
      readingPage,
    );

    expect(formatFmhyAnswer("audiobook library", resources)).toContain("Audio Library");
    expect(formatFmhyAnswer("audiobook library", resources)).toContain("[Audio Library](https://example.com/audiobooks)");
    expect(formatFmhyAnswer("audiobook library", resources)).not.toContain("**");
  });

  it("turns a fallback into a query-specific starting point instead of the repeated citation script", () => {
    const resources = extractFmhyResources(
      `
        <li><a href="https://example.com/audiobooks">Audio Library</a> - Audiobooks</li>
        <li><a href="https://example.com/books">Open Books</a> - Public-domain ebooks</li>
      `,
      readingPage,
    );

    const answer = formatFmhyAnswer("audiobook library", resources);

    expect(answer).toBe(
      "Try [Audio Library](https://example.com/audiobooks) first for audiobook library—FMHY describes it as Audiobooks. [Open Books](https://example.com/books) may also be useful.",
    );
    expect(answer).not.toContain("FMHY lists");
    expect(answer).not.toContain("Each title opens");
  });

  it("uses the FMHY section when a resource excerpt contains only presentation markers", () => {
    const resources = extractFmhyResources(
      `<li>⭐ <a href="https://example.com/tts">Audio Generators</a> - ️</li>`,
      readingPage,
    );

    expect(formatFmhyAnswer("audiobook resources", resources)).toBe(
      "Try [Audio Generators](https://example.com/tts) first for audiobook resources—It is listed in FMHY’s Reading section.",
    );
  });

  it("varies deterministic recommendation openings for question and recommendation intents", () => {
    const resources = extractFmhyResources(
      `<li><a href="https://example.com/audiobooks">Audio Library</a> - Audiobooks</li>`,
      readingPage,
    );

    expect(formatFmhyAnswer("Where can I find audiobook resources?", resources)).toBe(
      "A useful place to begin is [Audio Library](https://example.com/audiobooks)—FMHY describes it as Audiobooks.",
    );
    expect(formatFmhyAnswer("recommended audiobook resources", resources)).toBe(
      "I’d start with [Audio Library](https://example.com/audiobooks)—FMHY describes it as Audiobooks.",
    );
    expect(formatFmhyAnswer("free audiobook resources", resources)).toBe(
      "Try [Audio Library](https://example.com/audiobooks) first for free audiobook resources—FMHY describes it as Audiobooks.",
    );
  });

  it("resolves an additional-options follow-up against its prior FMHY query and excludes resources already shown", () => {
    expect(prepareFmhySearchRequest("any other options?", {
      previousQuery: "What are the recommended music tools?",
      shownResources: [
        { label: "AudioMass", section: "Audio" },
        { label: "MusicBrainz", section: "Audio" },
      ],
    })).toEqual({
      query: "What are the recommended music tools?",
      additionalOptions: true,
      excludedTitles: ["audiomass", "musicbrainz"],
    });
  });

  it("retains accumulated shown resources beyond one result batch for a later generic follow-up", () => {
    const shownResources = [
      "AudioMass",
      "MusicBrainz",
      "Soundation",
      "BandLab",
      "Cakewalk",
      "GarageBand",
      "LMMS",
    ].map((label) => ({ label, section: "Audio" }));

    expect(prepareFmhySearchRequest("anything else?", {
      previousQuery: "What are the recommended music tools?",
      shownResources,
    }).excludedTitles).toEqual([
      "audiomass",
      "musicbrainz",
      "soundation",
      "bandlab",
      "cakewalk",
      "garageband",
      "lmms",
    ]);
  });

  it("keeps a specific new request independent when an untrusted client also supplies session context", () => {
    expect(prepareFmhySearchRequest("more open-source music production tools", {
      previousQuery: "What are the recommended music tools?",
      shownResources: [{ label: "AudioMass", section: "Audio" }],
    })).toEqual({
      query: "more open-source music production tools",
      additionalOptions: false,
      excludedTitles: [],
    });
  });

  it("turns only retrieved FMHY resource titles in a grounded summary into direct Markdown links", () => {
    const resources = extractFmhyResources(
      `<li><a href="https://example.com/audiobooks">Audio Library</a> - Audiobooks</li>`,
      readingPage,
    );

    expect(linkFmhyResourceTitles("Try Audio Library for spoken books.", resources)).toBe(
      "Try [Audio Library](https://example.com/audiobooks) for spoken books.",
    );
  });

  it("reports an unavailable FMHY source separately from a genuine no-result search", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("FMHY is unavailable")));

    const response = await searchFmhy("audiobook library");

    expect(response).toMatchObject({
      status: "UNAVAILABLE",
      sources: [],
    });
    expect(response.answer).toContain("could not be reached");
  });

  it("deduplicates simultaneous official FMHY page fetches across equivalent searches", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      `<h3 id="audiobooks">Audiobooks</h3><ul><li><a href="https://example.com/audio-library">Audio Library</a> - Audiobooks</li></ul>`,
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Reading"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Reading"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Reading"] }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pages: ["Reading"] }) } }] } as never);

    await Promise.all([
      searchFmhy("audiobook library"),
      searchFmhy("audiobook library"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("reports a failed grounded selector as unavailable rather than an FMHY no-match", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      `<h3 id="audiobooks">Audiobooks <a class="header-anchor" href="#audiobooks">​</a></h3>
       <ul><li><a href="https://example.com/audio-library">Audio Library</a> - Audiobooks</li></ul>`,
      { status: 200 },
    )));
    vi.mocked(invokeLLM).mockRejectedValueOnce(new Error("LLM invoke failed: 412 Precondition Failed"));

    const response = await searchFmhy("audiobook library");

    expect(response).toMatchObject({
      status: "UNAVAILABLE",
      sources: [],
    });
    expect(response.answer).toContain("temporarily unavailable");
  });

  it("preserves a bounded Groq retry interval in the FMHY unavailable response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      `<h3 id="audiobooks">Audiobooks <a class="header-anchor" href="#audiobooks">​</a></h3>
       <ul><li><a href="https://example.com/audio-library">Audio Library</a> - Audiobooks</li></ul>`,
      { status: 200 },
    )));
    vi.mocked(invokeLLM).mockRejectedValueOnce(Object.assign(
      new Error("Groq is rate limited"),
      { retryAfterSeconds: 17 },
    ));

    const response = await searchFmhy("audiobook library");

    expect(response).toMatchObject({ status: "UNAVAILABLE", sources: [] });
    expect(response.answer).toMatch(/try again in 17 seconds/i);
  });
});
