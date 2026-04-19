import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser-safe client (anon key). Use from React components / client code.
let _browser: SupabaseClient | null = null;
export function supabaseBrowser(): SupabaseClient {
  if (_browser) return _browser;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  _browser = createClient(url, anon, { auth: { persistSession: false } });
  return _browser;
}

// Server-side client. On the server we prefer the service role so we can
// upsert/ingest, but we fall back to the anon key for read-only routes.
let _server: SupabaseClient | null = null;
export function supabaseServer(): SupabaseClient {
  if (_server) return _server;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase env for server client");
  _server = createClient(url, key, { auth: { persistSession: false } });
  return _server;
}
