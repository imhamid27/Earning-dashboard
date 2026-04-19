import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { jsonOk, jsonError, cleanTicker } from "@/lib/api";
import { supabaseServer } from "@/lib/supabase";

// POST /api/refresh-company
// Body: { ticker: "RELIANCE.NS" }
//
// Runs our Screener scraper on-demand for a single ticker. Useful when a
// company has just announced but our nightly pipeline hasn't run yet — the
// user clicks "Fetch now" on the dashboard and gets fresh numbers.
//
// Returns the updated rows so the UI can refresh without a round-trip.
export const runtime = "nodejs";  // we spawn a Python subprocess
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { /* fallthrough */ }
  const ticker = cleanTicker(body?.ticker);
  if (!ticker) return jsonError("missing or invalid ticker", 400);

  const scriptPath = path.resolve(process.cwd(), "scripts", "screener_results.py");

  // Pick the right Python binary: `py` on Windows, `python3` elsewhere.
  const py = process.platform === "win32" ? "py" : "python3";

  const start = Date.now();
  const result = await new Promise<{ ok: boolean; log: string }>((resolve) => {
    const child = spawn(py, [scriptPath, "--ticker", ticker], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout?.on("data", (d) => { log += d.toString(); });
    child.stderr?.on("data", (d) => { log += d.toString(); });
    child.on("error", (e) => resolve({ ok: false, log: `spawn error: ${e.message}` }));
    child.on("close", (code) => resolve({ ok: code === 0, log: log.trim() }));
  });

  if (!result.ok) {
    return jsonError(
      "Refresh failed. Try again in a moment.",
      502
    );
  }

  const sb = supabaseServer();
  const { data: rows, error } = await sb
    .from("quarterly_financials")
    .select("ticker,quarter_label,quarter_end_date,revenue,net_profit,operating_profit,eps,data_quality_status,fetched_at")
    .eq("ticker", ticker)
    .order("quarter_end_date", { ascending: false })
    .limit(8);
  if (error) return jsonError(error.message, 500);

  return jsonOk({
    ticker,
    elapsed_ms: Date.now() - start,
    rows: rows ?? []
  });
}
