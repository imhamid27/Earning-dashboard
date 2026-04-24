const DEFAULT_SITE_URL = "https://earnings.thecore.in";

export function siteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    DEFAULT_SITE_URL;

  return raw.replace(/\/+$/, "");
}
