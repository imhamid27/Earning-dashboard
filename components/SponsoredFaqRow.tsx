"use client";

// A sponsored row that sits among the FAQ rows and is drawn exactly like them: numbered badge, bold line,
// chevron, expandable body. It carries a "Sponsored" tag, is not counted as a question and is not in the FAQ
// structured data. Same offers and rotation as the other sponsored cards. Renders nothing when none are on.
// The badge number comes from a CSS counter on the list, so the numbering stays 01, 02, 03 with or without it.
import { SPONSORED_REL, useSponsoredOffer } from "@/components/useSponsoredOffer";

export default function SponsoredFaqRow() {
  const card = useSponsoredOffer();
  if (!card) return null;
  return (
    <details open className="group faq-row [counter-increment:faq]">
      <summary className="flex cursor-pointer list-none select-none items-start gap-4 px-5 py-4 transition-colors hover:bg-[rgba(236,45,122,0.025)] md:px-6 md:py-5">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-core-line text-[11px] font-bold tabular-nums text-core-muted after:content-[counter(faq,decimal-leading-zero)] group-open:border-core-pink group-open:bg-[rgba(236,45,122,0.06)] group-open:text-core-pink" />
        <span className="flex-1 text-[15px] font-bold leading-snug text-core-ink group-hover:text-core-pink group-open:text-core-pink md:text-[16px]">
          {card.title}{" "}
          <span className="ml-1 inline-flex translate-y-[-1px] items-center gap-1 rounded-full bg-core-ink/5 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-[0.12em] text-core-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-core-pink" aria-hidden="true" />
            Sponsored
          </span>
        </span>
        <span aria-hidden className="mt-1 inline-block h-5 w-5 shrink-0 text-core-muted transition-transform duration-200 group-open:rotate-180 group-open:text-core-pink">
          <svg viewBox="0 0 20 20" fill="none" className="h-full w-full">
            <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </summary>
      <div className="-mt-1 px-5 pb-5 md:-mt-1.5 md:px-6 md:pb-6">
        <div className="ml-11 max-w-3xl text-[14px] leading-relaxed text-core-muted md:text-[15px]">
          {card.text}
          <div className="mt-3">
            <a href={card.url} target="_blank" rel={SPONSORED_REL} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-core-pink px-5 text-[14px] font-bold text-white active:brightness-90">
              {card.cta} <span aria-hidden="true">&rarr;</span>
            </a>
          </div>
          {card.note ? <p className="mt-2 text-[11px] text-core-muted/80">{card.note}</p> : null}
        </div>
      </div>
    </details>
  );
}
