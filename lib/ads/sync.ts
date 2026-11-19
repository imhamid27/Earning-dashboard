import { getStore } from "./store";
import { syncCuelinks } from "./cuelinks";
import { syncAdmitad } from "./admitad";

// Runs both networks. A network without credentials is skipped and reported as not configured.
export async function runSync() {
  const store = getStore();
  const out: any = { updated: new Date().toISOString() };
  try { out.cuelinks = process.env.CUELINKS_API_KEY ? await syncCuelinks(store) : { ok: false, failed: "", configured: false }; }
  catch (e: any) { out.cuelinks = { ok: false, failed: "error: " + String(e?.message || "unknown").slice(0, 120) }; }
  try { out.admitad = process.env.ADMITAD_CLIENT_ID && process.env.ADMITAD_CLIENT_SECRET ? await syncAdmitad(store) : { ok: false, failed: "", configured: false }; }
  catch (e: any) { out.admitad = { ok: false, failed: "error: " + String(e?.message || "unknown").slice(0, 120) }; }
  await store.setKv("sync_status", out);
  return out;
}
