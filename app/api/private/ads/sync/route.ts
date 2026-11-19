// Private: runs the Cuelinks and Admitad sync. Called by the "Sync now" button and by the Coolify
// scheduled task (see AD_TRACKER.md). Uses CUELINKS_API_KEY, ADMITAD_CLIENT_ID, ADMITAD_CLIENT_SECRET,
// ADMITAD_WEBSITE_ID from runtime env. Returns only ok/failed per network, never keys.
import { guard, json } from "@/lib/ads/guard";
import { runSync } from "@/lib/ads/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const denied = guard(req, true); if (denied) return denied;
  try { return json(await runSync()); } catch (e: any) { return json({ error: String(e?.message || "sync failed").slice(0, 200) }, 500); }
}
