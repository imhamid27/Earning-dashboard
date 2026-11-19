"use client";

// A sponsored row that sits at the end of an FAQ list and is drawn like the other rows (numbered badge
// slot, bold line, muted copy). It is labelled "Sponsored", is not counted as a question and is not in the
// FAQ structured data. Same offers and rotation as the other sponsored cards. Renders nothing when none are on.
import { SPONSORED_REL, useSponsoredOffer } from "@/components/useSponsoredOffer";

export default function SponsoredFaqRow() {
  const card = useSponsoredOffer();
  if (!card) return null;
  return (
    <aside aria-label="Sponsored" className="flex items-start gap-4 bg-[rgba(236,45,122,0.03)] px-5 py-4 md:px-6 md:py-5">
      <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-core-line text-[10px] font-bold uppercase text-core-muted">Ad</span>
      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-core-muted">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-core-pink" aria-hidden="true" />
          Sponsored
        </span>
        <div className="mt-1 flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold leading-snug text-core-ink md:text-[16px]">{card.title}</div>
            <p className="mt-1 max-w-3xl text-[14px] leading-relaxed text-core-muted md:text-[15px]">{card.text}</p>
          </div>
          <a href={card.url} target="_blank" rel={SPONSORED_REL} className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 self-start rounded-md bg-core-pink px-5 text-[14px] font-bold text-white active:brightness-90 md:h-10">
            {card.cta} <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
        {card.note ? <p className="mt-1.5 text-[11px] text-core-muted/80">{card.note}</p> : null}
      </div>
    </aside>
  );
}
