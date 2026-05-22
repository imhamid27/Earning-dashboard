// GET /api/indexnow-key
//
// Serves the IndexNow verification key as plain text. IndexNow partners
// (Bing, Yandex, Naver, Seznam) fetch this URL once after we submit URLs
// to api.indexnow.org/IndexNow, to verify we own the domain. The body
// must be EXACTLY the same key string we send in the submission payload.
//
// The key itself lives in the INDEXNOW_KEY env var so it's not committed
// to the repo. Generate with `openssl rand -hex 32` and set on the
// deployment.
//
// Failure mode: if the env var isn't set, return 404 so IndexNow knows
// IndexNow isn't enabled — better than serving an empty body and getting
// our submissions rejected with a confusing error.

import { NextResponse } from "next/server";

// Always re-execute (the key shouldn't be cached at the CDN edge — if we
// ever rotate it, edge caches would serve the old key and partners would
// reject submissions until the cache expired).
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
