"use client";

// Sponsored "next step" card. Always labelled "Sponsored". Shows one offer chosen for the current page;
// when several offers match, it rotates between them on each visit (a per-page counter in localStorage).
// Renders nothing until offers arrive, and nothing at all when none are switched on.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { pageKeyForPath } from "@/lib/ads/pages";

type Card = { id: string; title: string; text: string; cta: string; note: string; url: string };

export default function SponsoredCard() {
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
  return (
    <aside className="container-core mt-10" aria-label="Sponsored">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-core-line bg-core-surface px-5 py-4">
        <div className="min-w-0 max-w-2xl">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-core-muted">Sponsored</span>
          <h3 className="mt-1 text-[15px] font-semibold text-core-ink">{card.title}</h3>
          <p className="mt-0.5 text-sm text-core-muted">{card.text}</p>
          {card.note ? <p className="mt-1 text-xs text-core-muted">{card.note}</p> : null}
        </div>
        <a
          href={card.url}
          target="_blank"
          rel="sponsored nofollow noopener noreferrer"
          className="shrink-0 rounded-lg bg-core-ink px-4 py-2 text-sm font-semibold text-white hover:bg-[#262626]"
        >
          {card.cta} &rarr;
        </a>
      </div>
    </aside>
  );
}
