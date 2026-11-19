"use client";

// Picks the sponsored offer for the current page. One offer is chosen per page; when several match,
// it rotates on each visit (a counter in localStorage). Returns null until offers arrive, and when none are on.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { pageKeyForPath } from "@/lib/ads/pages";

export type SponsoredOffer = { id: string; title: string; text: string; cta: string; note: string; url: string };

export const SPONSORED_REL = "sponsored nofollow noopener noreferrer";

export function useSponsoredOffer(): SponsoredOffer | null {
  const pathname = usePathname() || "/";
  const page = pageKeyForPath(pathname);
  const [card, setCard] = useState<SponsoredOffer | null>(null);

  useEffect(() => {
    setCard(null);
    if (!page) return;
    let gone = false;
    fetch(`/api/ads?page=${encodeURIComponent(page)}`)
      .then((r) => (r.ok ? r.json() : { offers: [] }))
      .then((j) => {
        if (gone) return;
        const list: SponsoredOffer[] = (Array.isArray(j.offers) ? j.offers : []).filter((o: SponsoredOffer) => o && typeof o.url === "string" && /^https:\/\//.test(o.url) && o.title && o.text && o.cta);
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

  return card;
}
