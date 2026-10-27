import { NextRequest } from "next/server";
import { CASES, getCase, ICSR_FIELDS, type CaseBundle, type DocKind } from "@/lib/cases";
import { runGraph } from "@/lib/engine/graph";
import { configuredProvider, modelChain } from "@/lib/engine/llm";
import type { ReviewAction } from "@/lib/engine/types";
import { rateLimited, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const KINDS: DocKind[] = ["physician_note", "patient_diary", "lab_report", "ae_form"];
const ACTIONS = ["accept", "correct", "choose", "co_suspect", "mark_unknown"] as const;
const LIMITS = { docs: 4, pagesPerDoc: 30, charsPerPage: 20000, totalChars: 60000 };

function bad(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json" } });
}

function parseReviews(raw: unknown): Record<string, ReviewAction> | string {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return "reviews must be an object";
  const keys = new Set<string>(ICSR_FIELDS.map((f) => f.key));
  const out: Record<string, ReviewAction> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!keys.has(k)) return `unknown field in reviews: ${k}`;
    const r = v as Partial<ReviewAction>;
    if (!r || !ACTIONS.includes(r.action as (typeof ACTIONS)[number])) return `invalid action for ${k}`;
    const reason = String(r.reason ?? "").trim();
    const by = String(r.by ?? "").trim();
    if (!reason) return `a reason is required for the decision on ${k}`;
    if (!by) return `a reviewer name is required for the decision on ${k}`;
    out[k] = {
      action: r.action as ReviewAction["action"],
      value: r.value == null ? null : String(r.value).slice(0, 300),
      reason: reason.slice(0, 500),
      by: by.slice(0, 80),
      at: typeof r.at === "string" ? r.at.slice(0, 40) : new Date().toISOString(),
    };
  }
  return out;
}

export async function POST(req: NextRequest) {
  if (rateLimited(clientKey(req), 30, 5 * 60 * 1000)) return bad("Too many runs from this address. Wait a few minutes and try again.", 429);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad("Request body must be JSON.");

  const reviews = parseReviews(body.reviews);
  if (typeof reviews === "string") return bad(reviews);

  let bundle: CaseBundle | undefined;
  const uploaded = body.uploaded as { title?: string; kind?: string; text?: string; pages?: string[] }[] | undefined;

  if (uploaded !== undefined) {
    if (!Array.isArray(uploaded) || uploaded.length === 0) return bad("Add at least one document.");
    if (uploaded.length > LIMITS.docs) return bad(`At most ${LIMITS.docs} documents per case.`);
    let total = 0;
    const docs: CaseBundle["documents"] = [];
    for (const [i, u] of uploaded.entries()) {
      const pages = Array.isArray(u.pages) && u.pages.length ? u.pages.map(String) : [String(u.text ?? "")];
      if (pages.length > LIMITS.pagesPerDoc) return bad(`Document ${i + 1} has more than ${LIMITS.pagesPerDoc} pages.`);
      for (const p of pages) {
        if (p.length > LIMITS.charsPerPage) return bad(`Document ${i + 1} has a page longer than ${LIMITS.charsPerPage.toLocaleString()} characters.`, 413);
        total += p.length;
      }
      docs.push({
        id: `up-${i + 1}`,
        kind: (KINDS.includes(u.kind as DocKind) ? u.kind : "physician_note") as DocKind,
        title: String(u.title || `Document ${i + 1}`).slice(0, 120),
        received: new Date().toISOString(),
        pages: pages.map((text, j) => ({ n: j + 1, text: text.replace(/\r\n?/g, "\n") })),
      });
    }
    if (total > LIMITS.totalChars) return bad(`Documents total more than ${LIMITS.totalChars.toLocaleString()} characters.`, 413);
    if (docs.every((d) => d.pages.every((p) => p.text.replace(/\s/g, "").length < 20))) return bad("The documents are empty or too short to read.");
    const id = typeof body.caseId === "string" && /^UPLOAD-[A-Z0-9]{4,10}$/.test(body.caseId) ? body.caseId : `UPLOAD-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    bundle = { id, label: "Your documents", blurb: "User-supplied documents. No reference answer, so accuracy is not scored.", set: "upload", documents: docs };
  } else {
    bundle = getCase(typeof body.caseId === "string" ? body.caseId : CASES[0].id);
    if (!bundle) return bad("Unknown case.", 404);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      const p = configuredProvider();
      send({ kind: "meta", provider: p, chain: modelChain(p) });
      try {
        for await (const ev of runGraph(bundle!, reviews)) send(ev);
      } catch (err) {
        send({ kind: "error", message: err instanceof Error ? err.message : "unknown_error" });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET() {
  const p = configuredProvider();
  return Response.json({
    cases: CASES.map((c) => ({ id: c.id, label: c.label, blurb: c.blurb, set: c.set, docs: c.documents.length })),
    provider: p,
    chain: modelChain(p),
  });
}
