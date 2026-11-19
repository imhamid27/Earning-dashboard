"use client";

// Sponsored slot. One component, two shapes, both built from the site's own parts (hairline rules,
// pink-dot eyebrow, bold title, muted copy) so it reads as part of the page. Always labelled "Sponsored".
//   <SponsoredCard />         a ruled "next step" strip, placed by each page after its first block of content
//   <SponsoredCard tile=".." /> a tile that sits in a card grid (extra class sets how many columns it spans)
// One offer is chosen per page; when several match it rotates on each visit (a counter in localStorage).
// Renders nothing until offers arrive, and nothing at all when none are switched on.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { pageKeyForPath } from "@/lib/ads/pages";

type Card = { id: string; title: string; text: string; cta: string; note: string; url: string };

const REL = "sponsored nofollow noopener noreferrer";

export default function SponsoredCard({ tile, className = "" }: { tile?: string; className?: string }) {
  const pathname = usePathname() || "/";
  const page = pageKeyForPath(pathname);
  const [card, setCard] = useState<Card | null>(null);

  useEffect(() => {
    setCard(null);
    if (!page) return;
    let gone = false;
    fetch(`/api/ads?page=${encodeURIComponent(page)}`)
      .then((r) => (r.ok ? r.json() : { offers: [] }))
      .then((j) => {
        if (gone) return;
        const list: Card[] = (Array.isArray(j.offers) ? j.offers : []).filter((o: Card) => o && typeof o.url === "string" && /^https:\/\//.test(o.url) && o.title && o.text && o.cta);
        if (!list.length) return;
        let n = 0;
        if (list.length > 1) {
          try {
            const k = "core-promo-n:" + page;
            n = (parseInt(localStorage.getItem(k) || "0", 10) || 0) + 1;
            localStorage.setItem(k, String(n));
          } catch { n = Math.floor(Math.random() * 1000); }
        }
        setCard(list[n % list.length]);
      })
      .catch(() => {});
    return () => { gone = true; };
  }, [page]);

  if (!card) return null;

  const label = (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-core-muted">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-core-pink" aria-hidden="true" />
      Sponsored
    </span>
  );

  if (tile !== undefined) {
    return (
      <aside className={"h-full " + tile} aria-label="Sponsored">
        <div className={"flex h-full flex-col justify-between gap-3 rounded-lg border border-core-line bg-core-pink/[0.03] px-4 py-3" + (tile.includes("wide") ? " sm:flex-row sm:items-center sm:justify-between sm:gap-5" : "")}>
          <div className="min-w-0">
            {label}
            <div className="mt-1 text-[13px] font-bold leading-snug text-core-ink">{card.title}</div>
            <p className="mt-0.5 text-[12px] leading-snug text-core-muted">{card.text}</p>
          </div>
          <a href={card.url} target="_blank" rel={REL} className={"inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md bg-core-pink px-4 text-[13px] font-bold text-white active:brightness-90 sm:h-9" + (tile.includes("wide") ? "" : " w-full")}>
            {card.cta} <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
        {card.note ? <p className="mt-1 px-1 text-[10.5px] text-core-muted/80">{card.note}</p> : null}
      </aside>
    );
  }

  return (
    <aside className={className} aria-label="Sponsored">
      <div className="max-w-3xl border-l-2 border-core-pink py-0.5 pl-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <div className="min-w-0 flex-1">
            {label}
            <h3 className="mt-1 text-[15px] font-bold leading-snug tracking-tight text-core-ink">{card.title}</h3>
            <p className="mt-0.5 text-[13px] leading-snug text-core-muted">{card.text}</p>
          </div>
          <a href={card.url} target="_blank" rel={REL} className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-md bg-core-pink px-5 text-[14px] font-bold text-white active:brightness-90 sm:h-10">
            {card.cta} <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
        {card.note ? <p className="mt-1.5 text-[11px] text-core-muted/80">{card.note}</p> : null}
      </div>
    </aside>
  );
}
