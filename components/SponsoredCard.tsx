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

export default function SponsoredCard({ inline = false }: { inline?: boolean }) {
  const pathname = usePathname() || "/";
  const page = pageKeyForPath(pathname);
  const [card, setCard] = useState<Card | null>(null);
  const skip = !inline && !!page && INLINE_PAGES.includes(page);

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
  return (
    <aside className={inline ? "my-5 md:my-6" : "container-core mt-10"} aria-label="Sponsored">
      <div className="relative overflow-hidden rounded-xl border border-core-line bg-white shadow-sm">
        <span className="absolute inset-y-0 left-0 w-1 bg-core-pink" aria-hidden="true" />
        <div className="flex flex-col gap-4 py-5 pl-6 pr-5 md:flex-row md:items-center md:justify-between md:gap-8 md:py-6 md:pl-7 md:pr-7">
          <div className="min-w-0 max-w-2xl">
            <span className="inline-block rounded bg-core-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-core-muted">Sponsored</span>
            <h3 className="mt-2 text-lg font-extrabold leading-snug tracking-tight text-core-ink md:text-xl">{card.title}</h3>
            <p className="mt-1 text-[14px] leading-relaxed text-core-muted">{card.text}</p>
            {card.note ? <p className="mt-2 text-[11.5px] text-core-muted/80">{card.note}</p> : null}
          </div>
          <a
            href={card.url}
            target="_blank"
            rel="sponsored nofollow noopener noreferrer"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-core-pink px-6 py-3 text-[15px] font-bold text-white shadow-sm transition hover:brightness-95 md:min-w-[190px]"
          >
            {card.cta} <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
      </div>
    </aside>
  );
}
