/** FMHY Reference Tool: compact, direct resource access with visible FMHY provenance. */

import { ArrowUpRight, CircleDot, CornerDownRight, Globe2, Star } from "lucide-react";
import React from "react";
import type { SourceCitation as SourceCitationType } from "@/lib/chat";

const categoryIcons: Record<string, string> = {
  reading: "📗",
  music: "🎵",
  video: "📺",
  games: "🎮",
  software: "💻",
  learning: "🎓",
  other: "🗂️",
};

function categoryIcon(section: string) {
  return categoryIcons[section.toLowerCase()] ?? "↪️";
}

export function SourceCitation({ source }: { source: SourceCitationType }) {
  const resourceHref = source.resourceHref ?? source.href;
  const relevanceClass = source.relevance === "Direct match" ? "fmhy-match-direct" : "fmhy-match-related";

  return (
    <article className="fmhy-resource-row">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <a className="fmhy-resource-title" href={resourceHref} rel="noreferrer" target="_blank">
          {source.label} <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </a>
        <span className={`fmhy-match-label ${relevanceClass}`}>
          <CircleDot aria-hidden="true" className="size-2.5" />
          {source.relevance}
        </span>
      </div>
      <p className="fmhy-resource-excerpt">{source.excerpt}</p>
      <div className="fmhy-resource-meta">
        <a className="fmhy-category-link" href={source.href} rel="noreferrer" target="_blank">
          <span aria-hidden="true">{categoryIcon(source.section)}</span>
          Browse {source.section} on FMHY <ArrowUpRight aria-hidden="true" className="size-3" />
        </a>
        {source.markers?.recommended ? <span className="fmhy-wiki-marker fmhy-wiki-marker-star"><Star aria-hidden="true" className="size-3" fill="currentColor" /> Recommended by FMHY</span> : null}
        {source.markers?.thirdPartyIndex ? <span className="fmhy-wiki-marker fmhy-wiki-marker-index"><Globe2 aria-hidden="true" className="size-3" /> Third-party index</span> : null}
        {source.markers?.sectionLink ? <span className="fmhy-wiki-marker fmhy-wiki-marker-section"><CornerDownRight aria-hidden="true" className="size-3" /> Section link</span> : null}
      </div>
    </article>
  );
}
