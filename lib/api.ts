// Small helpers shared by every /api route.
import { NextResponse } from "next/server";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, {
    ...init,
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      ...(init?.headers ?? {})
    }
  });
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

// Validate a ticker string. Accepts letters, digits, dot, dash, ampersand.
export function cleanTicker(input: string | null): string | null {
  if (!input) return null;
  const t = input.trim().toUpperCase();
  return /^[A-Z0-9.&-]{1,20}$/.test(t) ? t : null;
}

export function cleanQuarterLabel(input: string | null): string | null {
  if (!input) return null;
  const t = input.trim().toUpperCase().replace(/\s+/g, " ");
  return /^Q[1-4]\s*FY\d{2,4}$/.test(t) ? t.replace(/\s+/g, " ") : null;
}
