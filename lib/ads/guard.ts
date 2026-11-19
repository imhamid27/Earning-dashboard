import { basicAuthOk, writeHeadersOk, unauthorized } from "./auth";

// Returns a Response to send back when the request is not allowed, or null when it may proceed.
export function guard(req: Request, write: boolean): Response | null {
  if (!basicAuthOk(req.headers.get("authorization"))) return unauthorized();
  if (write && !writeHeadersOk(req)) return Response.json({ error: "bad request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  return null;
}

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
