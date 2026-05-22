// GET /indexnow.txt
//
// IndexNow key-verification endpoint. Serves the value of INDEXNOW_KEY
// as a plain-text body so partner crawlers (Bing, Yandex, Seznam, Naver)
// can confirm domain ownership before accepting our URL submissions.
//
// Critical: this file MUST live at the host root (i.e. /indexnow.txt,
// not /api/indexnow.txt). The IndexNow protocol restricts the URLs you
// can submit to those under the key file's directory. A root-level key
// file covers every URL on the host; a subdirectory file (like
// /api/indexnow-key) only covers URLs under /api/* — which means
// submissions for /, /q4, /company/* etc. get rejected with HTTP 422
// "One or more URLs are not related to your site verified through the
// keylocation parameter". We moved here from /api/indexnow-key after
// hitting that error in the live smoke test.
//
// The .txt extension isn't required by the spec but is the convention
// most IndexNow examples use. Keeps the route discoverable from the
// URL alone.

import { NextResponse } from "next/server";

// Always re-execute (the key shouldn't be cached at the CDN edge — if
// we ever rotate it, edge caches would serve the old key and partners
// would reject submissions until the cache expired).
export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.INDEXNOW_KEY;
  if (!key) {
    return new NextResponse("IndexNow not configured", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new NextResponse(key, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
