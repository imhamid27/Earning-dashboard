import { PAGE_KEYS } from "./pages";

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null);

export const isHttps = (u: unknown): u is string => typeof u === "string" && /^https:\/\/[^/\s]+\.[^/\s]+/.test(u) && u.length <= 500 && !/\s/.test(u);

// Cuelinks links on this site must carry this site's channel id. Set CUELINKS_CID; unset means no rewriting.
export function fixUrl(u: string): string {
  const cid = (process.env.CUELINKS_CID || "").replace(/\D/g, "");
  return cid && /^https:\/\/linksredirect\.com\/\?/.test(u) ? u.replace(/([?&]cid=)\d+/, "$1" + cid) : u;
}

export type Fields = { title: string; text: string; cta: string; note: string; url: string };

// Heading, text, button, note, link. Link may be blank for a draft.
export function parseFields(b: any, needUrl: boolean): Fields | { error: string } {
  const title = str(b?.title, 80), text = str(b?.text, 220), cta = str(b?.cta, 30);
  if (!title || !text || !cta) return { error: "Heading, text and button are required (80, 220 and 30 characters at most)" };
  let note = "";
  if (b.note !== undefined && b.note !== "") { const n = str(b.note, 140); if (!n) return { error: "Note is too long (140 at most)" }; note = n; }
  const raw = typeof b.url === "string" ? b.url.trim() : "";
  let url = "";
  if (raw) { if (!isHttps(raw)) return { error: "Link must be a full https address" }; url = fixUrl(raw); }
  else if (needUrl) return { error: "A link is needed" };
  return { title, text, cta, note, url };
}

export function parsePages(p: unknown): string[] | { error: string } {
  if (!Array.isArray(p) || p.length < 1 || p.length > PAGE_KEYS.length) return { error: "Choose at least one page" };
  if (!p.every((x) => typeof x === "string" && PAGE_KEYS.includes(x))) return { error: "Unknown page" };
  return [...new Set(p as string[])];
}
