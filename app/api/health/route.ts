import { NextRequest } from "next/server";
import { configuredProvider, modelChain, pingModel } from "@/lib/engine/llm";
import { rateLimited, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/health          → what is configured (no model call)
 *  GET /api/health?ping=1   → one tiny model call, cached for 5 minutes, so the
 *                             header badge never claims a model that does not answer */
export async function GET(req: NextRequest) {
  const p = configuredProvider();
  if (req.nextUrl.searchParams.get("ping") !== "1" || !p) return Response.json({ provider: p, chain: modelChain(p), ok: p ? null : false });
  if (rateLimited("ping:" + clientKey(req), 10, 60 * 1000)) return Response.json({ provider: p, chain: modelChain(p), ok: null, error: "rate limited" });
  const r = await pingModel();
  return Response.json({ ...r, chain: modelChain(p) });
}
