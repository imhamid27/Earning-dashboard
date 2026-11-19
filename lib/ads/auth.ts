// Password gate for the ad tracker and its API. Runtime env vars only:
//   AD_TRACKER_PASSWORD  required. If unset, everything stays locked.
//   AD_TRACKER_USER      optional, default "admin".
// Used by middleware.ts (first gate) and again inside each private route.

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function basicAuthOk(header: string | null): boolean {
  const pass = process.env.AD_TRACKER_PASSWORD;
  if (!pass || pass.length < 8) return false;
  const user = process.env.AD_TRACKER_USER || "admin";
  if (!header || !header.startsWith("Basic ")) return false;
  let decoded = "";
  try { decoded = atob(header.slice(6).trim()); } catch { return false; }
  const i = decoded.indexOf(":");
  if (i < 0) return false;
  const okUser = safeEqual(decoded.slice(0, i), user);
  const okPass = safeEqual(decoded.slice(i + 1), pass);
  return okUser && okPass;
}

// A cross-site form cannot send this header or a JSON content type.
export function writeHeadersOk(req: Request): boolean {
  return req.headers.get("x-requested-with") === "tracker" && /application\/json/.test(req.headers.get("content-type") || "");
}

export const unauthorized = () =>
  new Response("Sign in required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Ad tracker", charset="UTF-8"', "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" },
  });
