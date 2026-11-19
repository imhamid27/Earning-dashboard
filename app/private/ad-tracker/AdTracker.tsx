"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Offer = {
  id: string; network: "cuelinks" | "admitad"; campaignId: number | null; name: string; domain: string; pages: string[];
  title: string; text: string; cta: string; note: string; url: string;
  orig: { title: string; text: string; cta: string; note: string; url: string };
  live: boolean; autoPaused: boolean; pausedReason: string; liveAt: string | null;
};
type Cand = { id: number; name: string; net: "cuelinks" | "admitad"; categories: string[]; currency: string; epc: number; access: string; domain: string; link: string; payout: string; payoutType: string };
type PageDef = { key: string; label: string; path: string };
type State = {
  ok: boolean; error?: string; pages: PageDef[]; offers?: Offer[];
  env: { cuelinks: boolean; cuelinksCid: boolean; admitad: boolean; admitadSite: boolean; memoryStore: boolean };
  status?: any; cuReports?: any; cuSug?: any; adReports?: any; adSug?: any;
};

const num = (v: any) => (parseFloat(v) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const money = (v: any, cur?: string) => (cur === "USD" ? "USD " : "Rs ") + (parseFloat(v) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "never");
const joined = (c: Cand) => ["active", "approved"].includes(String(c.access).toLowerCase());

async function call(path: string, body?: unknown) {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST", cache: "no-store", credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json", "X-Requested-With": "tracker" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Request failed (" + r.status + ")");
  return j;
}

const field = "w-full rounded-lg border border-core-line bg-white px-3 py-2 text-sm text-core-ink";
const btn = "rounded-lg border border-core-line px-3 py-1.5 text-xs font-semibold text-core-ink hover:bg-core-surface disabled:opacity-50";
const btnInk = "rounded-lg bg-core-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#262626] disabled:opacity-50";

function Pill({ kind, children }: { kind: "live" | "off" | "bad" | "draft"; children: React.ReactNode }) {
  const c = { live: "bg-core-teal/10 text-core-teal", off: "bg-core-ink/5 text-core-muted", bad: "bg-core-negative/10 text-core-negative", draft: "bg-amber-100 text-amber-800" }[kind];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${c}`}>{children}</span>;
}
const Tile = ({ v, l }: { v: string; l: string }) => (
  <div className="rounded-xl border border-core-line bg-white px-4 py-3"><div className="text-2xl font-semibold tabular-nums text-core-ink">{v}</div><div className="text-xs text-core-muted">{l}</div></div>
);

function statusOf(o: Offer): { kind: "live" | "off" | "bad" | "draft"; label: string } {
  if (!o.url) return { kind: "draft", label: "Draft, no link yet" };
  if (o.autoPaused) return { kind: "bad", label: "Paused: " + o.pausedReason };
  return o.live ? { kind: "live", label: "Live" } : { kind: "off", label: "Switched off" };
}

function PagePicker({ pages, value, onChange }: { pages: PageDef[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {pages.map((p) => (
        <label key={p.key} className="flex cursor-pointer items-center gap-1.5 rounded-full bg-core-ink/5 px-3 py-1 text-xs">
          <input type="checkbox" checked={value.includes(p.key)} onChange={(e) => onChange(e.target.checked ? [...value, p.key] : value.filter((x) => x !== p.key))} />
          {p.label}
        </label>
      ))}
    </div>
  );
}

function CopyForm({ pages, init, submitLabel, onSubmit, onCancel, extra }: {
  pages: PageDef[]; init: { title: string; text: string; cta: string; note: string; url: string; pages: string[] }; submitLabel: string;
  onSubmit: (v: any) => Promise<void>; onCancel?: () => void; extra?: React.ReactNode;
}) {
  const [v, setV] = useState(init); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k: string, x: string) => setV({ ...v, [k]: x });
  return (
    <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); try { await onSubmit(v); } catch (x: any) { setErr(x.message); } setBusy(false); }}>
      <label className="text-xs text-core-muted">Heading<input className={field} value={v.title} maxLength={80} onChange={(e) => set("title", e.target.value)} /></label>
      <label className="text-xs text-core-muted">Button<input className={field} value={v.cta} maxLength={30} onChange={(e) => set("cta", e.target.value)} /></label>
      <label className="text-xs text-core-muted sm:col-span-2">Text<textarea className={field} rows={2} value={v.text} maxLength={220} onChange={(e) => set("text", e.target.value)} /></label>
      <label className="text-xs text-core-muted sm:col-span-2">Note (optional, small print under the text)<input className={field} value={v.note} maxLength={140} onChange={(e) => set("note", e.target.value)} /></label>
      <label className="text-xs text-core-muted sm:col-span-2">Link (https). Open it and check where it lands before switching the card on.
        <input className={field} value={v.url} onChange={(e) => set("url", e.target.value)} /></label>
      <div className="sm:col-span-2"><div className="mb-1 text-xs text-core-muted">Pages</div><PagePicker pages={pages} value={v.pages} onChange={(p) => setV({ ...v, pages: p })} /></div>
      {extra}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button className={btnInk} disabled={busy}>{submitLabel}</button>
        {onCancel ? <button type="button" className={btn} onClick={onCancel}>Cancel</button> : null}
        {err ? <span className="text-xs text-core-negative">{err}</span> : null}
      </div>
    </form>
  );
}

function OfferCard({ o, pages, act }: { o: Offer; pages: PageDef[]; act: (b: any) => Promise<void> }) {
  const [edit, setEdit] = useState(false); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const st = statusOf(o);
  const edited = (["title", "text", "cta", "note", "url"] as const).some((k) => o[k] !== (o.orig[k] || ""));
  const run = async (b: any) => { setBusy(true); setMsg(""); try { await act({ id: o.id, ...b }); } catch (x: any) { setMsg(x.message); } setBusy(false); };
  return (
    <div className="rounded-xl border border-core-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2"><b className="text-sm text-core-ink">{o.name || o.id}</b><Pill kind={st.kind}>{st.label}</Pill></div>
          <div className="mt-0.5 text-xs text-core-muted">{o.network === "admitad" ? "Admitad" : "Cuelinks"} campaign {o.campaignId}{o.domain ? " · " + o.domain : ""}{o.liveAt ? " · live since " + when(o.liveAt) : ""}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">{o.pages.map((p) => <span key={p} className="rounded bg-core-ink/5 px-2 py-0.5 text-xs">{pages.find((x) => x.key === p)?.label || p}</span>)}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={o.live ? btn : btnInk} disabled={busy || (!o.live && !o.url)} onClick={() => run({ op: "switch", on: !o.live })}>{o.live ? "Switch off" : "Switch on"}</button>
          <button className={btn} onClick={() => setEdit(!edit)}>Edit</button>
          <button className={btn} disabled={busy || !edited} onClick={() => run({ op: "reset" })}>Reset</button>
          <button className={btn} disabled={busy} onClick={() => { if (confirm("Remove this offer?")) run({ op: "remove" }); }}>Remove</button>
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-dashed border-core-line p-3">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-core-muted">Sponsored</span>
        <div className="text-sm font-semibold text-core-ink">{o.title}</div>
        <div className="text-sm text-core-muted">{o.text}</div>
        {o.note ? <div className="mt-1 text-xs text-core-muted">{o.note}</div> : null}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <span className="rounded bg-core-ink px-2.5 py-1 font-semibold text-white">{o.cta} &rarr;</span>
          {o.url ? <a className="break-all text-core-pink underline" href={o.url} target="_blank" rel="noopener noreferrer">Open link to check it</a> : <span className="text-core-muted">No link yet. It is filled in on the next sync once the campaign is joined, or paste one.</span>}
        </div>
      </div>
      {msg ? <p className="mt-2 text-xs text-core-negative">{msg}</p> : null}
      {edit ? <CopyForm pages={pages} init={{ title: o.title, text: o.text, cta: o.cta, note: o.note, url: o.url, pages: o.pages }} submitLabel="Save" onCancel={() => setEdit(false)}
        onSubmit={async (v) => { await act({ id: o.id, op: "save", ...v }); setEdit(false); }} /> : null}
    </div>
  );
}

function Suggestions({ st, pages, added, act }: { st: State; pages: PageDef[]; added: Set<string>; act: (b: any) => Promise<void> }) {
  const [net, setNet] = useState<"admitad" | "cuelinks">("admitad");
  const [q, setQ] = useState(""); const [cat, setCat] = useState(""); const [all, setAll] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const data = net === "admitad" ? st.adSug : st.cuSug;
  const items: Cand[] = data?.items || [];
  const cats = useMemo(() => [...new Set(items.flatMap((c) => c.categories))].sort(), [items]);
  const shown = items.filter((c) => (all || (joined(c) && c.link)) && (!cat || c.categories.includes(cat)) && (!q || c.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-core-muted">Campaigns the network offers for India. By default only campaigns this site has joined and that have a tracking link are listed, because the others cannot be used yet. Tick the box to browse the rest and apply on the network.</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2"><button className={net === "admitad" ? btnInk : btn} onClick={() => setNet("admitad")}>Admitad</button><button className={net === "cuelinks" ? btnInk : btn} onClick={() => setNet("cuelinks")}>Cuelinks</button></div>
        <input className={field + " max-w-xs"} placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={field + " max-w-[200px]"} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Show campaigns I have not joined or that have no link</label>
      </div>
      {!data ? <p className="rounded-xl border border-core-line bg-white p-6 text-center text-sm text-core-muted">No suggestions yet. Run a sync from the Setup tab.</p> : (
        <div className="overflow-hidden rounded-xl border border-core-line bg-white">
          <div className="border-b border-core-line px-4 py-2 text-xs text-core-muted">{shown.length} shown of {items.length} · updated {when(data.updated)}</div>
          {shown.length === 0 ? <p className="p-6 text-center text-sm text-core-muted">Nothing joined with a link here. {all ? "" : "Tick the box above to browse the rest."}</p> : shown.slice(0, 150).map((c) => {
            const id = (net === "admitad" ? "a" : "x") + c.id, done = added.has(id);
            return (
              <div key={c.id} className="border-b border-core-line px-4 py-3 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <b className="text-sm">{c.name}</b> <Pill kind={joined(c) && c.link ? "live" : "off"}>{joined(c) ? (c.link ? "Joined, link ready" : "Joined, no link") : "Not joined: " + (c.access || "unknown")}</Pill>
                    <div className="text-xs text-core-muted">{c.categories.join(", ")}{c.domain ? " · " + c.domain : ""}{c.epc ? " · EPC " + c.epc : ""}</div>
                  </div>
                  <div className="flex gap-2">
                    {c.link ? <a className={btn} href={c.link} target="_blank" rel="noopener noreferrer">Open link</a> : null}
                    <button className={btnInk} disabled={done} onClick={() => setAdding(adding === c.id ? null : c.id)}>{done ? "Added" : "Add as draft"}</button>
                  </div>
                </div>
                {adding === c.id ? (
                  <div>
                    <p className="mt-2 text-xs text-core-muted">Write the card after opening the link and seeing where it lands. A draft is not shown on the site until you switch it on.</p>
                    <CopyForm pages={pages} init={{ title: "", text: "", cta: "", note: "", url: c.link, pages: [] }} submitLabel="Add draft" onCancel={() => setAdding(null)}
                      onSubmit={async (v) => { await act({ op: "add", network: net, campaignId: c.id, name: c.name, domain: c.domain, ...v }); setAdding(null); }} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Earnings({ st }: { st: State }) {
  const p = st.cuReports?.performance?.totals, e = st.cuReports?.earnings?.data, cc = st.cuReports?.campaigns?.data;
  const a = st.adReports;
  return (
    <div className="space-y-6">
      <section><h2 className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-core-muted">Cuelinks, last 30 days</h2>
        {p ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Tile v={money(p.commission, p.currency)} l="Commission" /><Tile v={num(p.clicks)} l="Clicks" /><Tile v={num(p.transactions)} l="Sales" /><Tile v={money(p.epc, p.currency)} l="Per click" /></div> : <p className="text-sm text-core-muted">No Cuelinks numbers yet.</p>}
        {Array.isArray(e) && e.length ? <div className="mt-3 overflow-x-auto rounded-xl border border-core-line bg-white"><table className="w-full min-w-[560px] text-sm"><thead><tr className="text-left text-xs text-core-muted"><th className="p-3">Month</th><th className="p-3 text-right">Pending</th><th className="p-3 text-right">Validated</th><th className="p-3 text-right">Payable</th><th className="p-3 text-right">Total</th></tr></thead><tbody>{e.map((x: any) => <tr key={x.month} className="border-t border-core-line"><td className="p-3">{x.month}</td>{["pending", "validated", "payable", "total"].map((f) => <td key={f} className="p-3 text-right tabular-nums">{money(x[f], x.currency)}</td>)}</tr>)}</tbody></table></div> : null}
        {Array.isArray(cc) && cc.length ? <div className="mt-3 overflow-x-auto rounded-xl border border-core-line bg-white"><table className="w-full min-w-[480px] text-sm"><thead><tr className="text-left text-xs text-core-muted"><th className="p-3">Campaign</th><th className="p-3 text-right">Clicks</th><th className="p-3 text-right">Sales</th><th className="p-3 text-right">Commission</th></tr></thead><tbody>{cc.slice(0, 50).map((x: any, i: number) => <tr key={i} className="border-t border-core-line"><td className="p-3">{x.campaign_name}</td><td className="p-3 text-right">{num(x.clicks)}</td><td className="p-3 text-right">{num(x.transactions)}</td><td className="p-3 text-right">{money(x.commission, x.currency)}</td></tr>)}</tbody></table></div> : null}
      </section>
      <section><h2 className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-core-muted">Admitad, last 30 days</h2>
        {a ? <><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Tile v={money(a.totals.commission, a.totals.currency)} l="Commission" /><Tile v={num(a.totals.clicks)} l="Clicks" /><Tile v={num(a.totals.actions)} l="Actions" /><Tile v={money(a.totals.epc, a.totals.currency)} l="Per click" /></div>
          <div className="mt-3 overflow-x-auto rounded-xl border border-core-line bg-white"><table className="w-full min-w-[480px] text-sm"><thead><tr className="text-left text-xs text-core-muted"><th className="p-3">Month</th><th className="p-3 text-right">Pending</th><th className="p-3 text-right">Approved</th><th className="p-3 text-right">Declined</th><th className="p-3 text-right">Total</th></tr></thead><tbody>{a.months.map((x: any) => <tr key={x.month} className="border-t border-core-line"><td className="p-3">{x.month}</td>{["pending", "approved", "declined", "total"].map((f) => <td key={f} className="p-3 text-right tabular-nums">{money(x[f], a.totals.currency)}</td>)}</tr>)}</tbody></table></div>
          {a.campaigns.length ? <div className="mt-3 overflow-x-auto rounded-xl border border-core-line bg-white"><table className="w-full min-w-[480px] text-sm"><thead><tr className="text-left text-xs text-core-muted"><th className="p-3">Campaign</th><th className="p-3 text-right">Clicks</th><th className="p-3 text-right">Actions</th><th className="p-3 text-right">Commission</th></tr></thead><tbody>{a.campaigns.slice(0, 50).map((x: any, i: number) => <tr key={i} className="border-t border-core-line"><td className="p-3">{x.name}</td><td className="p-3 text-right">{num(x.clicks)}</td><td className="p-3 text-right">{num(x.actions)}</td><td className="p-3 text-right">{money(x.commission, x.currency)}</td></tr>)}</tbody></table></div> : null}</> : <p className="text-sm text-core-muted">No Admitad numbers yet.</p>}
      </section>
    </div>
  );
}

function Setup({ st, reload }: { st: State; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const row = (label: string, ok: boolean, hint?: string) => <li className="flex items-center gap-2"><Pill kind={ok ? "live" : "off"}>{ok ? "Set" : "Not set"}</Pill><code className="text-xs">{label}</code>{hint ? <span className="text-xs text-core-muted">{hint}</span> : null}</li>;
  const s = st.status;
  return (
    <div className="max-w-3xl space-y-5 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <button className={btnInk} disabled={busy} onClick={async () => { setBusy(true); setMsg(""); try { await call("/api/private/ads/sync", {}); await reload(); setMsg("Sync finished."); } catch (x: any) { setMsg(x.message); } setBusy(false); }}>{busy ? "Syncing…" : "Sync now"}</button>
        <span className="text-core-muted">Last sync: {s ? when(s.updated) : "never"}</span>{msg ? <span>{msg}</span> : null}
      </div>
      {s ? <ul className="space-y-1">{(["cuelinks", "admitad"] as const).map((n) => <li key={n}><b className="capitalize">{n}</b>: {s[n]?.configured === false ? "not configured" : s[n]?.ok ? "ok" : "problem: " + (s[n]?.failed || "unknown")}</li>)}</ul> : null}
      <div><h2 className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-core-muted">Runtime variables in Coolify (values are never shown)</h2>
        <ul className="space-y-1.5">
          {row("CUELINKS_API_KEY", st.env.cuelinks)}{row("CUELINKS_CID", st.env.cuelinksCid, "this site's Cuelinks channel id; links are rewritten to it")}
          {row("ADMITAD_CLIENT_ID and ADMITAD_CLIENT_SECRET", st.env.admitad)}{row("ADMITAD_WEBSITE_ID", st.env.admitadSite, "this site's Admitad ad space id; needed for joined status and tracking links")}
        </ul></div>
      {st.env.memoryStore ? <p className="rounded-lg bg-amber-100 p-3 text-amber-900">Local test mode: data is kept in memory and lost on restart.</p> : null}
      <p className="text-core-muted">Scheduled sync: see AD_TRACKER.md. Add a Coolify scheduled task that calls the sync endpoint a few times a day.</p>
    </div>
  );
}

export default function AdTracker() {
  const [st, setSt] = useState<State | null>(null); const [err, setErr] = useState(""); const [tab, setTab] = useState("overview");
  const reload = useCallback(async () => { try { setSt(await call("/api/private/ads")); setErr(""); } catch (x: any) { setErr(x.message); } }, []);
  useEffect(() => { reload(); }, [reload]);
  const act = useCallback(async (b: any) => { await call("/api/private/ads/offer", b); await reload(); }, [reload]);
  if (err) return <p className="container-core py-10 text-core-negative">{err}</p>;
  if (!st) return <p className="container-core py-10 text-core-muted">Loading…</p>;
  const offers = st.offers || [];
  const live = offers.filter((o) => o.live && !o.autoPaused && o.url), paused = offers.filter((o) => o.autoPaused), drafts = offers.filter((o) => !o.url);
  const tabs: [string, string][] = [["overview", "Overview"], ["offers", `Offers (${offers.length})`], ["suggestions", "Suggestions"], ["earnings", "Earnings"], ["setup", "Setup"]];
  return (
    <div className="container-core space-y-6 py-8">
      <header><h1 className="text-2xl font-semibold tracking-tight text-core-ink">Ad tracker</h1><p className="mt-1 max-w-2xl text-sm text-core-muted">Sponsored cards on the earnings site: what is live, what each network pays, and which campaigns to try next. Internal page.</p></header>
      <nav className="flex flex-wrap gap-2 border-b border-core-line pb-3" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? btnInk : btn} onClick={() => setTab(k)}>{l}</button>)}</nav>
      {!st.ok ? <div className="rounded-xl bg-core-negative/10 p-4 text-sm text-core-negative">The database could not be read: {st.error}. Run supabase/migration_ad_tracker.sql in Supabase and check SUPABASE_SERVICE_ROLE_KEY.</div> : null}
      {tab === "overview" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Tile v={String(live.length)} l="Cards showing on the site" /><Tile v={String(offers.length - live.length - paused.length - drafts.length)} l="Switched off" /><Tile v={String(paused.length)} l="Paused by the health check" /><Tile v={String(drafts.length)} l="Drafts without a link" /></div>
          {offers.length === 0 ? <p className="rounded-xl border border-core-line bg-white p-6 text-sm text-core-muted">No cards yet, so nothing sponsored shows on the site. Pick campaigns in Suggestions and add them as drafts.</p> : null}
          {paused.map((o) => <div key={o.id} className="rounded-xl bg-core-negative/10 p-3 text-sm"><b>Paused: {o.name || o.id}</b>. {o.pausedReason}. Its card is hidden until the campaign is back.</div>)}
          {offers.map((o) => { const s = statusOf(o); return <div key={o.id} className="flex items-center justify-between rounded-xl border border-core-line bg-white px-4 py-2.5 text-sm"><span>{o.name || o.id}</span><Pill kind={s.kind}>{s.label}</Pill></div>; })}
        </div>
      ) : null}
      {tab === "offers" ? <div className="space-y-4">{offers.length ? offers.map((o) => <OfferCard key={o.id} o={o} pages={st.pages} act={act} />) : <p className="text-sm text-core-muted">Nothing added yet.</p>}
        <p className="max-w-3xl text-xs text-core-muted">When several live offers match a page, the card rotates between them on each visit. A paused card returns by itself on the next sync once its campaign is fine. Switching on or off takes effect on the site within about a minute.</p></div> : null}
      {tab === "suggestions" ? <Suggestions st={st} pages={st.pages} added={new Set(offers.map((o) => o.id))} act={act} /> : null}
      {tab === "earnings" ? <Earnings st={st} /> : null}
      {tab === "setup" ? <Setup st={st} reload={reload} /> : null}
    </div>
  );
}
