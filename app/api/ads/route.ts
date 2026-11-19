// Public: the sponsored cards that may show on one page. Only switched-on, not auto-paused offers
// with an https link are returned, and only the fields the card needs.
import { NextResponse } from "next/server";
import { getStore } from "@/lib/ads/store";
import { PAGE_KEYS } from "@/lib/ads/pages";
import { isHttps } from "@/lib/ads/validate";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const page = new URL(req.url).searchParams.get("page") || "";
  // Short edge cache so a Switch off reaches readers within about a minute.
  const headers = { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=30" };
  if (!PAGE_KEYS.includes(page)) return NextResponse.json({ offers: [] }, { headers });
  try {
    const all = await getStore().listOffers();
    const offers = all
      .filter((o) => o.live && !o.autoPaused && isHttps(o.url) && o.pages.includes(page) && o.title && o.text && o.cta)
      .map((o) => ({ id: o.id, title: o.title, text: o.text, cta: o.cta, note: o.note, url: o.url }));
    return NextResponse.json({ offers }, { headers });
  } catch {
    // Missing tables or no database: show nothing, never break the page.
    return NextResponse.json({ offers: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
