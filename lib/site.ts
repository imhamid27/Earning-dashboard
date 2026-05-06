export function siteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    "https://earnings.thecore.in"; // public fallback — not a secret

  return raw.replace(/\/+$/, "");
}
