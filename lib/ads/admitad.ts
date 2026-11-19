// Admitad (read-only): earnings, suggestions, tracking-link fill and health of added cards.
// Needs ADMITAD_CLIENT_ID and ADMITAD_CLIENT_SECRET. ADMITAD_WEBSITE_ID (the ad space id) gives the
// connection status and the tracking link per campaign. Runtime variables only. Any doubt changes nothing.
import type { Store } from "./store";
import { getJson, sleep, blockRe, num, isHttpsLink, type Candidate } from "./sync-util";

const BASE = (process.env.ADMITAD_API_BASE || "https://api.admitad.com").replace(/\/+$/, "");
const results = (b: any): any[] => (Array.isArray(b) ? b : (b && b.results) || []);
const dmy = (d: Date) => String(d.getUTCDate()).padStart(2, "0") + "." + String(d.getUTCMonth() + 1).padStart(2, "0") + "." + d.getUTCFullYear();
const iso = (s: any) => { s = String(s || ""); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };

export async function syncAdmitad(store: Store): Promise<{ ok: boolean; failed: string; site: boolean }> {
  const ID = process.env.ADMITAD_CLIENT_ID, SECRET = process.env.ADMITAD_CLIENT_SECRET;
  const SITE = (process.env.ADMITAD_WEBSITE_ID || "").replace(/\D/g, "");
  if (!ID || !SECRET) return { ok: false, failed: "ADMITAD_CLIENT_ID / ADMITAD_CLIENT_SECRET not set", site: !!SITE };
  const now = new Date().toISOString(), failed: string[] = [];

  let token = "";
  for (let n = 1; n <= 3 && !token; n++) {
    try {
      const r = await fetch(BASE + "/token/", {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(60000),
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: ID, scope: "advcampaigns advcampaigns_for_website statistics websites" }),
        headers: { Authorization: "Basic " + Buffer.from(ID + ":" + SECRET).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (r.ok) { const j: any = await r.json(); if (j.access_token) token = j.access_token; }
      else { console.log("admitad token try " + n + " -> HTTP " + r.status); if ([400, 401, 403].includes(r.status)) break; }
    } catch (e: any) { console.log("admitad token try " + n + " -> " + (e?.name || "error")); }
    if (!token && n < 3) await sleep(4000);
  }
  if (!token) return { ok: false, failed: "token (check the id and secret)", site: !!SITE };
  const api = (p: string) => getJson("admitad " + p.split("?")[0], BASE + p, { Authorization: "Bearer " + token }, [400, 401, 403, 404]);

  // 1. earnings: 180 daily rows give the 30-day totals, the monthly table and the per-campaign table
  const today = new Date(), d30 = new Date(Date.now() - 30 * 86400000), d180 = new Date(Date.now() - 180 * 86400000);
  const dates = await api(`/statistics/dates/?limit=500&date_start=${dmy(d180)}&date_end=${dmy(today)}`);
  const camp = await api(`/statistics/campaigns/?limit=500&date_start=${dmy(d30)}&date_end=${dmy(today)}`);
  if (dates.status !== 200) failed.push(`statistics(${dates.status})`);
  if (camp.status !== 200) failed.push(`campaign-stats(${camp.status})`);
  if (dates.status === 200 || camp.status === 200) {
    const cutoff = iso(dmy(d30));
    const months: Record<string, any> = {};
    const tot = { clicks: 0, actions: 0, commission: 0, epc: 0, currency: "INR" };
    results(dates.body).forEach((r) => {
      const day = iso(r.date); if (!day) return;
      const m = day.slice(0, 7), x = months[m] || (months[m] = { month: m, pending: 0, approved: 0, declined: 0, total: 0 });
      x.pending += num(r.payment_sum_open); x.approved += num(r.payment_sum_approved); x.declined += num(r.payment_sum_declined); x.total += num(r.payment_sum);
      if (r.currency) tot.currency = r.currency;
      if (day >= cutoff) { tot.clicks += num(r.clicks); tot.actions += r.actions != null ? num(r.actions) : num(r.leads) + num(r.sales); tot.commission += num(r.payment_sum); }
    });
    tot.epc = tot.clicks ? tot.commission / tot.clicks : 0;
    const campaigns = results(camp.body).map((r) => ({ name: r.advcampaign_name || r.campaign_name || String(r.advcampaign_id || ""), clicks: num(r.clicks), actions: r.actions != null ? num(r.actions) : num(r.leads) + num(r.sales), commission: num(r.payment_sum), epc: num(r.clicks) ? num(r.payment_sum) / num(r.clicks) : 0, currency: r.currency || tot.currency }))
      .sort((a, b) => b.commission - a.commission).slice(0, 100);
    await store.setKv("admitad_reports", { updated: now, totals: tot, months: Object.values(months).sort((a: any, b: any) => (a.month < b.month ? 1 : -1)).slice(0, 12), campaigns });
  }

  // 2. campaigns: suggestions, health, link fill
  const rows: any[] = [];
  for (let off = 0; off < 2500; off += 500) {
    const q = `limit=500&offset=${off}&language=en`, p = SITE ? `/advcampaigns/website/${SITE}/?${q}` : `/advcampaigns/?${q}`;
    let r = await api(p + "&region=IN");
    if (r.status === 400) r = await api(p);
    if (r.status !== 200) { if (!rows.length) failed.push("advcampaigns"); break; }
    const got = results(r.body); rows.push(...got); if (got.length < 500) break;
  }
  const link = (c: any): string => [c.gotolink, c.goto_link].find(isHttpsLink) || "";
  const linkFor = async (id: number): Promise<string> => {
    if (!SITE) return "";
    const one = await api(`/advcampaigns/${id}/website/${SITE}/`);
    let u = one.status === 200 && one.body ? link(one.body) : "";
    if (!u) { const d = await api(`/deeplink/${SITE}/advcampaign/${id}/`); const b = d.status === 200 ? d.body : null; u = (Array.isArray(b) ? b[0] : b && b.link) || ""; if (!isHttpsLink(u)) u = ""; }
    return u;
  };
  if (rows.length) {
    const byId: Record<string, any> = {}; rows.forEach((c) => { byId[c.id] = c; });
    const conn = (c: any) => String(c.connection_status || "").toLowerCase();
    for (const o of (await store.listOffers()).filter((x) => x.network === "admitad" && x.campaignId)) {
      const c = byId[o.campaignId as number]; if (!c) continue; // not listed: unknown, change nothing
      const st = String(c.status || "").toLowerCase();
      let reason = "";
      if (["declined", "disabled"].includes(conn(c))) reason = "Access " + conn(c);
      else if (["closed", "disabled", "paused", "pause", "inactive"].includes(st)) reason = "Campaign " + st;
      let changed = false;
      if ((reason !== "") !== o.autoPaused || reason !== o.pausedReason) { o.autoPaused = reason !== ""; o.pausedReason = reason; changed = true; }
      // a draft gets its link once the campaign is joined; it is never switched on automatically
      if (SITE && !o.url && !o.live && conn(c) === "active") { const u = link(c) || (await linkFor(o.campaignId as number)); if (u) { o.url = u; o.orig = { ...o.orig, url: u }; changed = true; } }
      if (changed) await store.saveOffer(o);
    }
    // names end with the country code ("... [CPA] IN"): keep India only
    const block = blockRe();
    const pool: Candidate[] = rows.filter((c) => { const m = String(c.name || "").trim().match(/\s([A-Z]{2})$/); return m && m[1] === "IN"; })
      .filter((c) => !["declined", "disabled"].includes(conn(c)))
      .map((c) => ({ id: c.id, name: c.name, net: "admitad" as const, categories: (c.categories || []).map((x: any) => (typeof x === "string" ? x : x?.name)).filter(Boolean), payout: "", payoutType: "", currency: c.currency || "", epc: num(c.ecpc), access: String(c.connection_status || ""), domain: c.site_url || "", link: link(c) }))
      .filter((c) => !block.test(c.name + " " + c.categories.join(" ")))
      .sort((a, b) => (a.access === "active" ? 0 : 1) - (b.access === "active" ? 0 : 1) || b.epc - a.epc).slice(0, 300);
    // the list rarely carries the tracking link; ask for it for joined campaigns (the first 40)
    let asked = 0;
    for (const c of pool) if (!c.link && c.access.toLowerCase() === "active" && asked++ < 40) c.link = await linkFor(c.id);
    await store.setKv("admitad_suggestions", { updated: now, total: pool.length, site: !!SITE, items: pool });
  }
  return { ok: failed.length === 0, failed: failed.join(" "), site: !!SITE };
}
