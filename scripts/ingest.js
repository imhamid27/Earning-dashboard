#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * India Earnings Tracker — Node.js ingestion (yahoo-finance2).
 *
 * Usage:
 *   node scripts/ingest.js
 *   INGEST_TICKERS=RELIANCE.NS,TCS.NS node scripts/ingest.js
 *
 * This is a lightweight alternative to scripts/ingest.py. The Python path is
 * generally more reliable because yfinance exposes the full quarterly income
 * statement, whereas yahoo-finance2 only exposes a subset via the
 * `quoteSummary` `incomeStatementHistoryQuarterly` module. Use Node for
 * quick tests or when Python isn't available in your env.
 */

require("dotenv").config();
const yahooFinance = require("yahoo-finance2").default;
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const RPS = Number(process.env.INGEST_RPS || 2);
const DELAY_MS = Math.round(1000 / Math.max(RPS, 0.1));

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toFiscal(input) {
  const d = input instanceof Date ? input : new Date(input);
  const m = d.getUTCMonth() + 1;
  const y = d.getUTCFullYear();
  let fq, fyEnd, qMonth, qYear;
  if (m >= 4 && m <= 6)        { fq = 1; fyEnd = y + 1; qMonth = 6;  qYear = y; }
  else if (m >= 7 && m <= 9)   { fq = 2; fyEnd = y + 1; qMonth = 9;  qYear = y; }
  else if (m >= 10 && m <= 12) { fq = 3; fyEnd = y + 1; qMonth = 12; qYear = y; }
  else                          { fq = 4; fyEnd = y;     qMonth = 3;  qYear = y; }
  const lastDay = new Date(Date.UTC(qYear, qMonth, 0)).getUTCDate();
  const end = `${qYear}-${String(qMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { fy: fyEnd, fq, label: `Q${fq} FY${String(fyEnd).slice(-2)}`, end };
}

function num(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && "raw" in v) return num(v.raw);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchTicker(row) {
  const ticker = row.ticker;
  let summary;
  try {
    summary = await yahooFinance.quoteSummary(ticker, {
      modules: ["incomeStatementHistoryQuarterly", "earnings", "summaryDetail"]
    });
  } catch (e) {
    return { ok: false, written: 0, msg: `quoteSummary failed: ${e.message}` };
  }

  const statements = summary?.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? [];
  if (statements.length === 0) return { ok: false, written: 0, msg: "no quarterly statements" };

  let written = 0;
  for (const s of statements) {
    const endRaw = s.endDate;
    if (!endRaw) continue;
    const { fy, fq, label, end } = toFiscal(endRaw);
    const revenue = num(s.totalRevenue);
    const netProfit = num(s.netIncome);
    const opProfit = num(s.operatingIncome);
    if (revenue == null && netProfit == null) continue;

    const missing = [revenue, netProfit].filter((v) => v == null).length;
    const quality = missing === 0 ? "ok" : missing === 1 ? "partial" : "missing";

    const { error } = await sb.from("quarterly_financials").upsert({
      company_id: row.id,
      ticker,
      quarter_label: label,
      quarter_end_date: end,
      fiscal_year: fy,
      fiscal_quarter: fq,
      revenue,
      net_profit: netProfit,
      operating_profit: opProfit,
      eps: null,
      currency: "INR",
      source: "yahoo",
      raw_json: s,
      data_quality_status: quality,
      fetched_at: new Date().toISOString()
    }, { onConflict: "ticker,quarter_end_date" });
    if (error) return { ok: false, written, msg: error.message };
    written++;
  }
  return { ok: written > 0, written, msg: `wrote ${written} quarters` };
}

async function main() {
  const override = (process.env.INGEST_TICKERS || "").trim();
  let targets;
  if (override) {
    const list = override.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
    const { data, error } = await sb.from("companies").select("id,ticker,company_name").in("ticker", list);
    if (error) { console.error(error); process.exit(1); }
    targets = data ?? [];
  } else {
    const { data, error } = await sb.from("companies").select("id,ticker,company_name").eq("is_active", true);
    if (error) { console.error(error); process.exit(1); }
    targets = data ?? [];
  }

  if (targets.length === 0) { console.log("No companies to ingest."); return; }
  console.log(`Ingesting ${targets.length} tickers @ ${RPS} req/s ...`);

  let okCount = 0;
  let failCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    try {
      const res = await fetchTicker(row);
      await sb.from("fetch_logs").insert({
        ticker: row.ticker,
        source: "yahoo",
        fetch_status: res.ok ? "success" : "failed",
        message: res.msg
      });
      if (res.ok) okCount++; else failCount++;
      console.log(`[${String(i + 1).padStart(3, " ")}/${targets.length}] ${row.ticker.padEnd(16)} ${res.msg}`);
    } catch (e) {
      failCount++;
      await sb.from("fetch_logs").insert({ ticker: row.ticker, source: "yahoo", fetch_status: "failed", message: String(e) });
      console.error(`[${i + 1}/${targets.length}] ${row.ticker} ERROR`, e);
    }
    await sleep(DELAY_MS);
  }
  console.log(`\nDone. ${okCount} ok, ${failCount} failed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
