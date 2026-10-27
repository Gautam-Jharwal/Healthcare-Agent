import { NextRequest } from "next/server";
import { CASES } from "@/lib/cases";
import { runGraphToEnd } from "@/lib/engine/graph";
import { scoreCase, totals, type CaseScore } from "@/lib/engine/score";
import { configuredProvider } from "@/lib/engine/llm";
import { rateLimited, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const cache: Record<string, { at: number; body: unknown }> = {};

/** Runs every case that has a reference answer and scores every field. */
export async function GET(req: NextRequest) {
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  // Rules-only by default. ?live=1 uses the configured model on the three demo cases only,
  // so a public "re-run" cannot exhaust a free-tier quota or the 60-second function limit.
  const live = req.nextUrl.searchParams.get("live") === "1" && !!configuredProvider();
  const key = live ? "live" : "seeded";
  const hit = cache[key];
  if (hit && !fresh && Date.now() - hit.at < 10 * 60 * 1000) return Response.json({ ...(hit.body as object), cached: true });
  if (rateLimited("eval:" + clientKey(req), 4, 10 * 60 * 1000)) return Response.json({ error: "The evaluation was run recently from this address. Try again in a few minutes." }, { status: 429 });
  const started = Date.now();
  const scores: CaseScore[] = await Promise.all(
    CASES.filter((c) => c.reference && (!live || c.set === "core")).map(async (c) => {
      const t0 = Date.now();
      const f = await runGraphToEnd(c, {}, { seeded: !live });
      return scoreCase(c, f, Date.now() - t0)!;
    }),
  );
  const bySet = Object.fromEntries(["core", "stress", "heldout"].map((s) => [s, totals(scores.filter((x) => x.set === s))]));
  const body = { at: new Date().toISOString(), provider: configuredProvider(), live, ms: Date.now() - started, scores, bySet, totals: totals(scores) };
  cache[key] = { at: Date.now(), body };
  return Response.json(body);
}
