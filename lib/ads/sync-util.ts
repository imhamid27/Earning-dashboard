export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const num = (v: any) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
export const isHttpsLink = (u: any): u is string => typeof u === "string" && /^https:\/\//.test(u);
// Keep gambling and adult campaigns out of the suggestions. Override with AD_BLOCK (a regular expression).
export const blockRe = () => { try { return new RegExp(process.env.AD_BLOCK || "casino|betting|gambl|poker|rummy|fantasy|adult|dating|lottery", "i"); } catch { return /casino|betting|gambl/i; } };

// GET with retries. Never logs headers or keys. Statuses in `stop` are returned at once.
export async function getJson(tag: string, url: string, headers: Record<string, string>, stop: number[]): Promise<{ status: number; body?: any }> {
  for (let n = 1; n <= 3; n++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(60000), cache: "no-store" });
      if (r.ok) return { status: 200, body: await r.json() };
      console.log(`${tag} try ${n} -> HTTP ${r.status}`);
      if (stop.includes(r.status)) return { status: r.status };
    } catch (e: any) { console.log(`${tag} try ${n} -> ${e?.name || "error"}`); }
    if (n < 3) await sleep(4000);
  }
  return { status: 0 };
}

export type Candidate = { id: number; name: string; net: "cuelinks" | "admitad"; categories: string[]; payout: string; payoutType: string; currency: string; epc: number; access: string; domain: string; link: string };
