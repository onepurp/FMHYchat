import { describe, expect, it } from "vitest";
import { searchFmhy } from "./fmhy";

const runLiveFmhyTests = process.env.RUN_FMHY_LIVE_TESTS === "1";

describe.skipIf(!runLiveFmhyTests)("live FMHY search through Groq", () => {
  it("returns the canonical Internet Tools RSS result", async () => {
    const response = await searchFmhy("I want an rss reader");

    expect(response).toMatchObject({ status: "MATCHED" });
    expect(response.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        section: "Tools · RSS Readers",
        href: "https://fmhy.net/internet-tools",
      }),
    ]));
  }, 50_000);

  it("maps descriptive dinner planning to verified FMHY Food or Recipes resources", async () => {
    const response = await searchFmhy("I need help deciding what to prepare for dinner");

    expect(response).toMatchObject({ status: "MATCHED" });
    expect(response.sources.some(source => /^Miscellaneous · (Food|Recipes)$/.test(source.section))).toBe(true);
    expect(response.sources.map(source => source.label)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^(Food Multireddit|Dolici|Baking Calculators|Grocy|Still Tasty|SuperCook|MyFridgeFood|Food Mood|Budget Bytes)$/),
    ]));
    expect(response.sources.map(source => source.label)).not.toEqual(expect.arrayContaining([
      "WhatBeatsRock",
      "ThistoThat",
      "Drinkable",
    ]));
  }, 50_000);

  it("excludes unrelated utility sites from a live food-recommendation request", async () => {
    const response = await searchFmhy("I want to know what to cook and eat, any website that gives recommendations?");

    expect(response).toMatchObject({ status: "MATCHED" });
    expect(response.sources).not.toHaveLength(0);
    expect(response.sources.every(source => /^Miscellaneous · (Food|Recipes)$/.test(source.section))).toBe(true);
    expect(response.sources.map(source => source.label)).not.toEqual(expect.arrayContaining([
      "WhatBeatsRock",
      "ThistoThat",
      "Drinkable",
    ]));
  }, 50_000);

  it("keeps a recommendation-intent query within verified FMHY Audio resources", async () => {
    const response = await searchFmhy("What are the recommended music tools?");

    expect(response).toMatchObject({ status: "MATCHED" });
    expect(response.sources).not.toHaveLength(0);
    expect(response.sources.every(source => source.section.startsWith("Audio · "))).toBe(true);
  }, 50_000);
});
