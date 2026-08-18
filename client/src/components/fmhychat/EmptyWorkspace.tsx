/** FMHY Reference Tool: use a restrained, documentation-like empty state with source-first starter prompts. */

import { ArrowUpRight } from "lucide-react";
import { BrandMark } from "./BrandMark";
import { SourceCitation } from "./SourceCitation";

const suggestions = [
  "Where can I find open-source video tools?",
  "Show me FMHY’s reading resources",
  "What are the recommended music tools?",
];

export function EmptyWorkspace({ onSuggestion }: { onSuggestion: (value: string) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 items-start px-4 py-6 sm:px-7 lg:px-10">
      <section className="fmhy-empty-workspace">
        <div className="fmhy-empty-copy">
          <BrandMark />
          <div className="mt-5">
            <p className="fmhy-kicker">Source-first resource search</p>
            <h1>Start with the FMHY database.</h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-[#67676c] dark:text-[#b2b2aa]">
              Ask for a resource, category, or starting point. Every live result stays inside FMHY and points back to its source.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button className="fmhy-suggestion" key={suggestion} onClick={() => onSuggestion(suggestion)} type="button">
                {suggestion}
                <ArrowUpRight className="size-3.5" />
              </button>
            ))}
          </div>
        </div>

        <div className="fmhy-source-preview">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="fmhy-evidence-label">Citation preview</p>
            <span className="fmhy-source-badge">FMHY only</span>
          </div>
          <SourceCitation
            source={{
              label: "FreeMediaHeckYeah",
              href: "https://fmhy.net/",
              section: "Curated resource database",
              relevance: "Direct match",
              excerpt: "Answers retain their FMHY context as a compact source panel beneath the relevant response.",
            }}
          />
          <p className="fmhy-empty-preview-detail mt-3 text-xs leading-5 text-[#67676c] dark:text-[#b2b2aa]">Blue names the source. Green confirms the evidence and match context.</p>
        </div>
      </section>
    </div>
  );
}
