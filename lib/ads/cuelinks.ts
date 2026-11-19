// Cuelinks (read-only): reports, suggestions, health of added cards, tracking link fill.
// Needs CUELINKS_API_KEY (runtime variable only). Any doubt keeps the previous state.
import type { Store } from "./store";
import { getJson, blockRe, num, isHttpsLink, type Candidate } from "./sync-util";
import { fixUrl } from "./validate";

const BASE = (process.env.CUELINKS_API_BASE || "https://developers.cuelinks.com/pub_api/v3").replace(/\/+$/, "");
const list = (b: any): any[] => (Array.isArray(b) ? b : (b && (b.campaigns || b.data || b.results)) || []);
const one = (b: any) => (b && (b.campaign || b.data)) || b || {};
const cats = (c: any): string[] => (c.categories || []).map((x: any) => (typeof x === "string" ? x : x?.name)).filter(Boolean);
const linkOf = (c: any) => fixUrl([c.tracking_url, c.trackingUrl, c.affiliate_url, c.link].find(isHttpsLink) || "");
const slim = (c: any): Candidate => ({
  id: c.id, name: c.name || "", net: "cuelinks", categories: cats(c), payout: String(c.payout ?? ""), payoutType: c.payout_type || "",
  currency: c.payout_currency || "", epc: num(c.epc_90d), access: String(c.access_status || ""), domain: c.domain || c.url || "", link: linkOf(c),
});
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function syncCuelinks(store: Store): Promise<{ ok: boolean; failed: string }> {
  const KEY = process.env.CUELINKS_API_KEY;
  if (!KEY) return { ok: false, failed: "CUELINKS_API_KEY not set" };
  const H = { Authorization: "Token " + KEY };
  const api = (p: string) => getJson("cuelinks " + p.split("?")[0], BASE + p, H, [401, 403, 404, 422]);
  const now = new Date().toISOString(), failed: string[] = [];

  // 1. earnings reports (last 30 days). A failed report keeps the previous one.
  const start = ymd(Date.now() - 30 * 86400000), end = ymd(Date.now() - 86400000);
  const prev: any = (await store.getKv("cuelinks_reports")) || {};
  const rep: any = { performance: prev.performance || null, campaigns: prev.campaigns || null, earnings: prev.earnings || null };
  const reports: [string, string][] = [
    ["performance", `/reports/performance?start_date=${start}&end_date=${end}&per_page=100`],
    ["campaigns", `/reports/campaigns?start_date=${start}&end_date=${end}&per_page=100&sort=commission`],
    ["earnings", "/reports/earnings?per_page=12"],
  ];
  for (const [k, p] of reports) {
    const r = await api(p);
    if (r.status === 200) rep[k] = r.body; else failed.push(`${k}(${r.status})`);
  }
  await store.setKv("cuelinks_reports", { ...rep, updated: now, from: start, to: end });

  // 2. health of added Cuelinks cards; fill links on drafts. Only a definite "gone" pauses a card.
  const offers = (await store.listOffers()).filter((o) => o.network === "cuelinks" && o.campaignId);
  for (const o of offers) {
    const r = await api("/campaigns/" + o.campaignId);
    let paused = o.autoPaused, reason = o.pausedReason, changed = false;
    if (r.status === 404) { paused = true; reason = "Campaign not found"; }
    else if (r.status === 200) {
      const c = one(r.body), acc = String(c.access_status || "").toLowerCase(), st = String(c.status || c.campaign_status || "").toLowerCase();
      if (["blocked", "rejected"].includes(acc)) { paused = true; reason = "Access " + acc; }
      else if (["inactive", "paused", "closed", "expired", "deleted"].includes(st)) { paused = true; reason = "Campaign " + st; }
      else { paused = false; reason = ""; }
      const lk = linkOf(c);
      if (lk && !o.url && !o.live) { o.url = lk; o.orig = { ...o.orig, url: lk }; changed = true; }
    }
    if (paused !== o.autoPaused || reason !== o.pausedReason) { o.autoPaused = paused; o.pausedReason = reason; changed = true; }
    if (changed) await store.saveOffer(o);
  }

  // 3. suggestions: open and approved campaigns for India, best earners first
  const merged: Record<string, any> = {}; let bad = false;
  for (const acc of ["open", "approved"]) {
    // The API returns one page at a time (about 30 rows whatever per_page says), so walk the pages until one adds nothing new.
    for (let page = 1; page <= 30; page++) {
      const r = await api(`/campaigns?access_status=${acc}&country_id=252&per_page=100&page=${page}&sort=epc_90d&order=desc`);
      if (r.status !== 200) { if (page === 1) bad = true; break; }
      const rows = list(r.body); let fresh = 0;
      rows.forEach((c) => { if (c && c.id != null && !merged[c.id]) { merged[c.id] = c; fresh++; } });
      if (!rows.length || !fresh) break;
    }
  }
  if (!Object.keys(merged).length) failed.push("campaign list");
  else {
    const block = blockRe();
    const pool = Object.values(merged).map(slim).filter((c) => !block.test(c.name + " " + c.categories.join(" "))).slice(0, 300);
    await store.setKv("cuelinks_suggestions", { updated: now, partial: bad, total: pool.length, items: pool });
  }
  return { ok: failed.length === 0, failed: failed.join(" ") };
}
