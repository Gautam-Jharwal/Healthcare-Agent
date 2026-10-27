/**
 * The SURE agent graph.
 *
 *   intake → extract ⟲(self-correct) → [reviewer decisions] → terminology
 *          → evidence graph → risk → completeness → ROUTE
 *                ├─ critical conflict open      → escalate ─┐
 *                ├─ minimum criteria not met    → hold      ─┤
 *                └─ otherwise                   → draft ⟲   ─┤
 *                                                            └→ human gate (always)
 *
 * The path depends on the state of the case. A reviewer's decisions re-enter
 * the graph after extraction, so an escalated case can be adjudicated and
 * resumed rather than restarted.
 */

import type { CaseBundle } from "../cases";
import type { CaseFile, AgentResult, TraceEntry, ReviewAction, Route } from "./types";
import { newRunCtx, configuredProvider, type RunCtx } from "./llm";
import { intake, extract, applyReviews, terminology, evidenceGraph, risk, completeness, draft, humanGate } from "./agents";

export interface RoutingDecision {
  after: string;
  condition: string;
  chose: Route;
  because: string;
}

export interface StepEvent {
  kind: "step" | "routing" | "done";
  file?: CaseFile;
  trace?: TraceEntry;
  routing?: RoutingDecision;
}

export function emptyCaseFile(bundle: CaseBundle): CaseFile {
  const p = configuredProvider();
  return {
    caseId: bundle.id,
    caseLabel: bundle.label,
    documents: bundle.documents,
    inventory: [],
    quarantine: [],
    flags: [],
    drugs: [],
    fields: [],
    edges: [],
    conflicts: [],
    riskRank: null,
    clock: null,
    validity: null,
    linkedCases: [],
    gaps: [],
    followUpQuery: null,
    followUpLetter: null,
    route: null,
    narrative: null,
    narrativeCheck: null,
    codedEvent: null,
    halted: false,
    haltReason: null,
    haltAgent: null,
    reviews: {},
    trace: [],
    modelCalls: [],
    mode: p === "mock" ? "mock" : p ? "live" : "seeded",
    modelVersion: null,
  };
}

async function runNode(file: CaseFile, ctx: RunCtx, fn: (f: CaseFile, c: RunCtx) => Promise<AgentResult>) {
  const started = Date.now();
  const res = await fn(file, ctx);
  const trace: TraceEntry = { ...res.trace, seq: file.trace.length + 1, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started };
  const next: CaseFile = { ...file, ...res.patch, trace: [...file.trace, trace], modelCalls: [...ctx.calls] };
  return { file: next, trace };
}

function finaliseMode(file: CaseFile, ctx: RunCtx): CaseFile {
  if (!ctx.provider) return { ...file, mode: "seeded", modelVersion: null };
  if (ctx.provider === "mock") return { ...file, mode: "mock", modelVersion: "mock-model" };
  const models = [...new Set(ctx.calls.filter((c) => c.ok && c.model).map((c) => c.model))];
  const anyFail = ctx.calls.some((c) => !c.ok);
  const anyOk = ctx.calls.some((c) => c.ok);
  return { ...file, mode: anyOk && !anyFail ? "live" : anyOk ? "degraded" : "degraded", modelVersion: models.join(", ") || null };
}

export interface RunOptions {
  /** Force the rule-based path (used for build-time numbers on the overview page). */
  seeded?: boolean;
}

export async function* runGraph(bundle: CaseBundle, reviews: Record<string, ReviewAction> = {}, opts: RunOptions = {}): AsyncGenerator<StepEvent> {
  const ctx = newRunCtx();
  if (opts.seeded) ctx.provider = null;
  let file = { ...emptyCaseFile(bundle), ...(opts.seeded ? { mode: "seeded" as const } : {}) };

  const step = async (fn: (f: CaseFile, c: RunCtx) => Promise<AgentResult>) => {
    const r = await runNode(file, ctx, fn);
    file = r.file;
    return { kind: "step" as const, file, trace: r.trace };
  };

  yield await step(intake);
  yield await step(extract);
  if (Object.keys(reviews).length) yield await step(applyReviews(reviews));
  yield await step(terminology);
  yield await step(evidenceGraph);
  yield await step(risk);
  yield await step(completeness);

  // ---- conditional routing ----
  const critical = file.conflicts.find((c) => c.severity === "critical" && !c.resolved);
  let routing: RoutingDecision;
  if (critical) {
    routing = { after: "completeness", condition: "open conflict on a critical field?", chose: "escalate", because: `Conflict on "${critical.field}" is unresolved. Drafting over it would produce an unsupported narrative.` };
  } else if (file.validity && !file.validity.valid) {
    const missing = file.validity.criteria.filter((c) => !c.met).map((c) => c.label.toLowerCase());
    routing = { after: "completeness", condition: "all four ICSR minimum criteria met?", chose: "hold", because: `Missing ${missing.join(", ")}. Not yet a valid ICSR; held for follow-up.` };
  } else {
    routing = { after: "completeness", condition: "critical conflict open? minimum criteria met?", chose: "draft", because: "No critical conflict and the case is valid. Drafting from verified facts is permitted." };
  }
  file = { ...file, route: routing.chose };
  yield { kind: "routing", routing, file };

  yield await step(draft);
  yield await step(humanGate);
  file = finaliseMode(file, ctx);
  yield { kind: "done", file };
}

export async function runGraphToEnd(bundle: CaseBundle, reviews: Record<string, ReviewAction> = {}, opts: RunOptions = {}): Promise<CaseFile> {
  let last: CaseFile | null = null;
  for await (const ev of runGraph(bundle, reviews, opts)) if (ev.file) last = ev.file;
  if (!last) throw new Error("graph_produced_no_state");
  return last;
}
