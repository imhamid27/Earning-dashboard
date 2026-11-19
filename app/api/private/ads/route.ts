// Private: everything the dashboard shows, in one read. Behind the password (middleware and here).
import { getStore } from "@/lib/ads/store";
import { guard, json } from "@/lib/ads/guard";
import { AD_PAGES } from "@/lib/ads/pages";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = guard(req, false); if (denied) return denied;
  // Only whether each variable is set, never its value.
  const env = {
    cuelinks: !!process.env.CUELINKS_API_KEY,
    cuelinksCid: !!process.env.CUELINKS_CID,
    admitad: !!(process.env.ADMITAD_CLIENT_ID && process.env.ADMITAD_CLIENT_SECRET),
    admitadSite: !!process.env.ADMITAD_WEBSITE_ID,
    memoryStore: process.env.AD_STORE === "memory" && process.env.NODE_ENV !== "production",
  };
  try {
    const s = getStore();
    const [offers, status, cuReports, cuSug, adReports, adSug] = await Promise.all([
      s.listOffers(), s.getKv("sync_status"), s.getKv("cuelinks_reports"), s.getKv("cuelinks_suggestions"), s.getKv("admitad_reports"), s.getKv("admitad_suggestions"),
    ]);
    return json({ ok: true, env, pages: AD_PAGES, offers, status, cuReports, cuSug, adReports, adSug });
  } catch (e: any) {
    return json({ ok: false, env, pages: AD_PAGES, error: String(e?.message || "store error").slice(0, 200) }, 200);
  }
}
