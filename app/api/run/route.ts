import { NextRequest } from "next/server";
import { CASES, getCase, type CaseBundle } from "@/lib/cases";
import { runGraph } from "@/lib/agents/graph";
import { activeProvider, activeModelVersion } from "@/lib/agents/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Streams the agent run as newline-delimited JSON so the UI can animate the
 * trace as each agent finishes, rather than waiting for the whole graph.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { caseId, uploaded } = body as {
    caseId?: string;
    uploaded?: { title: string; kind: string; text: string }[];
  };

  let bundle: CaseBundle | undefined;

  if (uploaded?.length) {
    // An uploaded bundle has no reference answer — it is for exploration only.
    bundle = {
      id: `UPLOAD-${Date.now().toString().slice(-6)}`,
      label: "Uploaded bundle",
      blurb: "User-supplied documents. No reference answer, so accuracy is not scored for this run.",
      demoRole: "gaps",
      documents: uploaded.map((u, i) => ({
        id: `up-${i}`,
        kind: (["physician_note", "patient_diary", "lab_report", "ae_form"].includes(u.kind)
          ? u.kind
          : "physician_note") as CaseBundle["documents"][number]["kind"],
        title: u.title || `Uploaded document ${i + 1}`,
        received: new Date().toISOString(),
        pages: [{ n: 1, text: u.text }],
      })),
      reference: { fields: {}, expectedGaps: [], expectedStop: null },
    };
  } else {
    bundle = getCase(caseId ?? CASES[0].id);
  }

  if (!bundle) return new Response(JSON.stringify({ error: "unknown_case" }), { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      send({
        kind: "meta",
        mode: activeProvider() ? "live" : "seeded",
        modelVersion: activeModelVersion(),
        provider: activeProvider(),
      });
      try {
        for await (const ev of runGraph(bundle!)) send(ev);
      } catch (err) {
        send({ kind: "error", message: err instanceof Error ? err.message : "unknown_error" });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET() {
  return Response.json({
    cases: CASES.map((c) => ({ id: c.id, label: c.label, blurb: c.blurb, demoRole: c.demoRole, docs: c.documents.length })),
    mode: activeProvider() ? "live" : "seeded",
    modelVersion: activeModelVersion(),
  });
}
