"use client";

// Sponsored card. "inline" = placed mid-page by a page (home, sectors); default = above the footer on the other pages.
// Sponsored "next step" card. Always labelled "Sponsored". Shows one offer chosen for the current page;
// when several offers match, it rotates between them on each visit (a per-page counter in localStorage).
// Renders nothing until offers arrive, and nothing at all when none are switched on.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { pageKeyForPath } from "@/lib/ads/pages";

// Pages that place the card themselves with <SponsoredCard inline />; the footer one skips these.
export const INLINE_PAGES = ["home", "sectors"];

type Card = { id: string; title: string; text: string; cta: string; note: string; url: string };

export default function SponsoredCard({ inline = false, tile = false }: { inline?: boolean; tile?: boolean }) {
  const pathname = usePathname() || "/";
  const page = pageKeyForPath(pathname);
  const [card, setCard] = useState<Card | null>(null);
  const skip = !inline && !tile && !!page && INLINE_PAGES.includes(page);

  useEffect(() => {
    setCard(null);
    if (!page || skip) return;
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
  }, [page, skip]);

  if (!card || skip) return null;
  if (tile) {
    return (
      <aside className="h-full" aria-label="Sponsored">
        <div className="flex h-full flex-col rounded-lg border border-core-pink/30 bg-core-pink/[0.04] px-4 py-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[12px] font-bold text-core-pink">{card.title}</span>
            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-core-muted">Sponsored</span>
          </div>
          <p className="text-[12px] leading-snug text-core-muted">{card.text}</p>
          <a
            href={card.url}
            target="_blank"
            rel="sponsored nofollow noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold text-core-pink hover:underline"
          >
            {card.cta} <span aria-hidden="true">&rarr;</span>
          </a>
          {card.note ? <p className="mt-1 text-[10.5px] text-core-muted/80">{card.note}</p> : null}
        </div>
      </aside>
    );
  }
  return (
    <aside className={inline ? "my-3" : "container-core mt-8"} aria-label="Sponsored">
      <div className="relative overflow-hidden rounded-lg border border-core-line bg-white">
        <span className="absolute inset-y-0 left-0 w-[3px] bg-core-pink" aria-hidden="true" />
        <div className="flex flex-col gap-2.5 py-3 pl-5 pr-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded bg-core-surface px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.14em] text-core-muted">Sponsored</span>
              <h3 className="text-[15px] font-bold leading-snug text-core-ink">{card.title}</h3>
            </div>
            <p className="mt-0.5 text-[13px] leading-snug text-core-muted">{card.text}</p>
            {card.note ? <p className="mt-0.5 text-[11px] text-core-muted/80">{card.note}</p> : null}
          </div>
          <a
            href={card.url}
            target="_blank"
            rel="sponsored nofollow noopener noreferrer"
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-core-pink px-4 py-2 text-[13px] font-bold text-white transition hover:brightness-95"
          >
            {card.cta} <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
      </div>
    </aside>
  );
}
