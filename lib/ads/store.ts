// Durable store for the ad tracker: Supabase tables ad_offers and ad_kv (see
// supabase/migration_ad_tracker.sql). Server only, service role key required.
// AD_STORE=memory swaps in an in-process mock for local testing (never use in production).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Offer = {
  id: string;
  network: "cuelinks" | "admitad";
  campaignId: number | null;
  name: string;
  domain: string;
  pages: string[];
  title: string;
  text: string;
  cta: string;
  note: string;
  url: string;
  orig: { title: string; text: string; cta: string; note: string; url: string };
  live: boolean;
  autoPaused: boolean;
  pausedReason: string;
  liveAt: string | null;
  createdAt: string;
};

type Row = Record<string, any>;
const toOffer = (r: Row): Offer => ({
  id: r.id, network: r.network, campaignId: r.campaign_id, name: r.name || "", domain: r.domain || "",
  pages: r.pages || [], title: r.title || "", text: r.body || "", cta: r.cta || "", note: r.note || "", url: r.url || "",
  orig: r.orig || { title: "", text: "", cta: "", note: "", url: "" },
  live: !!r.live, autoPaused: !!r.auto_paused, pausedReason: r.paused_reason || "",
  liveAt: r.live_at || null, createdAt: r.created_at || "",
});
const toRow = (o: Offer): Row => ({
  id: o.id, network: o.network, campaign_id: o.campaignId, name: o.name, domain: o.domain, pages: o.pages,
  title: o.title, body: o.text, cta: o.cta, note: o.note, url: o.url, orig: o.orig,
  live: o.live, auto_paused: o.autoPaused, paused_reason: o.pausedReason, live_at: o.liveAt, created_at: o.createdAt || new Date().toISOString(),
});

export interface Store {
  listOffers(): Promise<Offer[]>;
  saveOffer(o: Offer): Promise<void>;
  deleteOffer(id: string): Promise<void>;
  getKv<T = any>(key: string): Promise<T | null>;
  setKv(key: string, value: unknown): Promise<void>;
}

class SupabaseStore implements Store {
  constructor(private db: SupabaseClient) {}
  async listOffers() {
    const { data, error } = await this.db.from("ad_offers").select("*").order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(toOffer);
  }
  async saveOffer(o: Offer) {
    const { error } = await this.db.from("ad_offers").upsert(toRow(o));
    if (error) throw new Error(error.message);
  }
  async deleteOffer(id: string) {
    const { error } = await this.db.from("ad_offers").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }
  async getKv<T>(key: string) {
    const { data, error } = await this.db.from("ad_kv").select("value").eq("key", key).maybeSingle();
    if (error) throw new Error(error.message);
    return (data ? data.value : null) as T | null;
  }
  async setKv(key: string, value: unknown) {
    const { error } = await this.db.from("ad_kv").upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  }
}

class MemoryStore implements Store {
  offers = new Map<string, Offer>();
  kv = new Map<string, unknown>();
  async listOffers() { return [...this.offers.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).map((o) => structuredClone(o)); }
  async saveOffer(o: Offer) { if (!o.createdAt) o.createdAt = new Date().toISOString(); this.offers.set(o.id, structuredClone(o)); }
  async deleteOffer(id: string) { this.offers.delete(id); }
  async getKv<T>(key: string) { return (this.kv.has(key) ? structuredClone(this.kv.get(key)) : null) as T | null; }
  async setKv(key: string, value: unknown) { this.kv.set(key, structuredClone(value)); }
}

const g = globalThis as any;
export function getStore(): Store {
  if (process.env.AD_STORE === "memory" && process.env.NODE_ENV !== "production") {
    return (g.__adMemStore ||= new MemoryStore());
  }
  if (g.__adSbStore) return g.__adSbStore;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Ad tracker needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  return (g.__adSbStore = new SupabaseStore(createClient(url, key, { auth: { persistSession: false } })));
}
