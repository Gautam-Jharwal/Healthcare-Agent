/**
 * The SURE agent graph.
 *
 * This is where the system is agentic rather than a prompt chain: the path
 * through the graph depends on the state of the case, and two of the edges
 * are conditional. A case with an unresolved critical conflict never reaches
 * the drafting node at all.
 *
 *   intake → extract → terminology → evidenceGraph → risk → completeness
 *          ├─ [critical conflict]      → escalate ──┐
 *          └─ [otherwise]              → draft    ──┤
 *                                                   └→ humanGate  (always)
 */

import type { CaseBundle } from "../cases";
import type { CaseFile, AgentResult, TraceEntry } from "./types";
import { activeProvider, activeModelVersion } from "./llm";
import { intake, extract, terminology, evidenceGraph, risk, completeness, draft, humanGate } from "./agents";

export interface RoutingDecision {
  after: string;
  condition: string;
  chose: string;
  because: string;
}

export interface StepEvent {
  kind: "step" | "routing" | "done";
  file?: CaseFile;
  trace?: TraceEntry;
  routing?: RoutingDecision;
}

export function emptyCaseFile(bundle: CaseBundle): CaseFile {
  return {
    caseId: bundle.id,
    caseLabel: bundle.label,
    documents: bundle.documents,
    inventory: [],
    fields: [],
    edges: [],
    conflicts: [],
    riskRank: null,
    gaps: [],
    followUpQuery: null,
    narrative: null,
    halted: false,
    haltReason: null,
    haltAgent: null,
    approvals: [],
    exported: false,
    trace: [],
    mode: activeProvider() ? "live" : "seeded",
    modelVersion: activeModelVersion(),
  };
}

async function runNode(
  file: CaseFile,
  fn: (f: CaseFile) => Promise<AgentResult>
): Promise<{ file: CaseFile; trace: TraceEntry }> {
  const started = Date.now();
  const res = await fn(file);
  const trace: TraceEntry = {
    ...res.trace,
    seq: file.trace.length + 1,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
  };
  const next: CaseFile = { ...file, ...res.patch, trace: [...file.trace, trace] };
  return { file: next, trace };
}

/**
 * Runs the graph, yielding after every node so the UI can animate the trace.
 */
export async function* runGraph(bundle: CaseBundle): AsyncGenerator<StepEvent> {
  let file = emptyCaseFile(bundle);

  const linear = [
    { name: "intake", fn: intake },
    { name: "extract", fn: extract },
    { name: "terminology", fn: terminology },
    { name: "evidenceGraph", fn: evidenceGraph },
    { name: "risk", fn: risk },
    { name: "completeness", fn: completeness },
  ];

  for (const node of linear) {
    const r = await runNode(file, node.fn);
    file = r.file;
    yield { kind: "step", file, trace: r.trace };
  }

  // ---- conditional edge: draft only when no critical conflict is open ----
  const critical = file.conflicts.find((c) => c.severity === "critical");
  const routing: RoutingDecision = {
    after: "completeness",
    condition: "any open conflict with severity = critical?",
    chose: critical ? "escalate (skip drafting)" : "draft",
    because: critical
      ? `Conflict on "${critical.field}" is unresolved. Drafting over it would produce an unsupported narrative.`
      : "No critical conflict open. Drafting from sourced facts is permitted.",
  };
  yield { kind: "routing", routing, file };

  const d = await runNode(file, draft);
  file = d.file;
  yield { kind: "step", file, trace: d.trace };

  // ---- the human gate is unconditional ----
  const h = await runNode(file, humanGate);
  file = h.file;
  yield { kind: "step", file, trace: h.trace };

  yield { kind: "done", file };
}

/** Convenience for the eval harness and for tests: run to completion. */
export async function runGraphToEnd(bundle: CaseBundle): Promise<CaseFile> {
  let last: CaseFile | null = null;
  for await (const ev of runGraph(bundle)) if (ev.file) last = ev.file;
  if (!last) throw new Error("graph_produced_no_state");
  return last;
}
