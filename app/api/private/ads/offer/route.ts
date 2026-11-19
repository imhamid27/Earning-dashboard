// Private: add a draft, edit, switch on/off, reset to the original copy, remove.
import { getStore, type Offer } from "@/lib/ads/store";
import { guard, json } from "@/lib/ads/guard";
import { parseFields, parsePages, isHttps } from "@/lib/ads/validate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = guard(req, true); if (denied) return denied;
  let b: any;
  try { const raw = await req.text(); if (raw.length > 8192) return json({ error: "too large" }, 400); b = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }
  if (!b || typeof b !== "object") return json({ error: "bad json" }, 400);
  const store = getStore();
  const all = await store.listOffers();

  if (b.op === "add") {
    const cid = b.campaignId;
    if (!Number.isInteger(cid) || cid <= 0) return json({ error: "bad campaign id" }, 400);
    const net = b.network === "admitad" ? "admitad" : "cuelinks";
    const id = (net === "admitad" ? "a" : "x") + cid;
    if (all.some((x) => x.id === id)) return json({ error: "already added" }, 409);
    const f = parseFields(b, false); if ("error" in f) return json(f, 400);
    const pages = parsePages(b.pages); if ("error" in pages) return json(pages, 400);
    const name = typeof b.name === "string" ? b.name.slice(0, 120) : id, domain = typeof b.domain === "string" ? b.domain.slice(0, 100) : "";
    const o: Offer = { id, network: net, campaignId: cid, name, domain, pages, ...f, orig: { ...f }, live: false, autoPaused: false, pausedReason: "", liveAt: null, createdAt: new Date().toISOString() };
    await store.saveOffer(o);
    return json({ offers: await store.listOffers() });
  }

  const o = all.find((x) => x.id === b.id);
  if (!o) return json({ error: "unknown offer" }, 400);
  if (b.op === "save") {
    const f = parseFields(b, false); if ("error" in f) return json(f, 400);
    const pages = parsePages(b.pages); if ("error" in pages) return json(pages, 400);
    Object.assign(o, f, { pages });
    if (!o.url) o.live = false;
  } else if (b.op === "switch") {
    if (typeof b.on !== "boolean") return json({ error: "bad request" }, 400);
    if (b.on && !isHttps(o.url)) return json({ error: "Add the link first" }, 400);
    if (b.on && !o.live) o.liveAt = new Date().toISOString();
    o.live = b.on;
  } else if (b.op === "reset") {
    Object.assign(o, o.orig);
    if (!o.url) o.live = false;
  } else if (b.op === "remove") {
    await store.deleteOffer(o.id);
    return json({ offers: await store.listOffers() });
  } else return json({ error: "bad op" }, 400);
  await store.saveOffer(o);
  return json({ offers: await store.listOffers() });
}
