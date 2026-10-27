/** Shared state and trace types for the SURE agent graph. */

import type { CaseDocument } from "../cases";

export type FieldStatus =
  | "sourced" // value present, every citation verified against the page
  | "gap" // should be present, is not — goes into the follow-up query
  | "conflict" // sources assert different values — a human must decide
  | "adjudicated" // a reviewer chose between candidates, with a reason
  | "corrected" // a reviewer replaced the value, with a reason
  | "confirmed_unknown"; // a reviewer confirmed it is genuinely unknown

export interface Citation {
  docId: string;
  docTitle: string;
  page: number;
  /** Verbatim span copied from the source page. Verified before it is trusted. */
  quote: string;
  verified?: boolean;
  /** Why verification failed, when it did. */
  rejectReason?: string;
}

export interface Candidate {
  value: string;
  citations: Citation[];
  note?: string;
}

export interface ExtractedField {
  key: string;
  label: string;
  critical: boolean;
  value: string | null;
  status: FieldStatus;
  candidates?: Candidate[];
  citations: Citation[];
  /** Plain-language note on how the value was obtained or why it is missing. */
  note?: string;
  /** Soft warnings that do not block the value (e.g. a numeric date read as DD/MM). */
  warnings?: string[];
  /** Which extractor produced the value. */
  source?: "rules" | "model" | "rules+model" | "reviewer";
  review?: ReviewAction;
  originalValue?: string | null;
}

export interface ReviewAction {
  action: "accept" | "correct" | "choose" | "co_suspect" | "mark_unknown";
  value?: string | null;
  reason: string;
  by: string;
  at: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: string;
  /** Never "causal". SURE does not assert causality. */
  status: "documented" | "candidate" | "unresolved";
  note?: string;
}

export interface Conflict {
  field: string;
  description: string;
  candidates: Candidate[];
  severity: "critical" | "minor";
  resolved?: boolean;
}

export interface ToolCall {
  tool: string;
  input: string;
  output: string;
  ok?: boolean;
}

export interface TraceEntry {
  seq: number;
  agent: string;
  agentLabel: string;
  startedAt: string;
  durationMs: number;
  summary: string;
  toolCalls: ToolCall[];
  stopConditionChecked: string;
  stopTriggered: boolean;
  modelVersion: string | null;
  outputKeys: string[];
}

export interface Flag {
  code:
    | "unreadable_page"
    | "prompt_injection"
    | "personal_identifier"
    | "possible_follow_up"
    | "hys_law"
    | "severe_thrombocytopenia"
    | "lab_alert"
    | "fatal_or_life_threatening"
    | "ambiguous_date_format"
    | "regional_language"
    | "model_rule_disagreement"
    | "citation_rejected"
    | "narrative_rejected"
    | "invalid_icsr";
  severity: "info" | "warn" | "critical";
  message: string;
  docId?: string;
  page?: number;
}

export interface ModelCallRecord {
  agent: string;
  purpose: string;
  model: string | null;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface DrugRecord {
  name: string;
  dose: string | null;
  start: string | null;
  stop: string | null;
  longTerm: boolean;
  explicitSuspect: boolean;
  citations: Citation[];
  stopCitations: Citation[];
}

export interface Validity {
  valid: boolean;
  criteria: { key: string; label: string; met: boolean; detail: string }[];
}

export interface Clock {
  day0: string;
  basis: string;
  days: number | null;
  due: string | null;
  rule: string;
  note: string;
}

export type Route = "draft" | "escalate" | "hold";

export interface NarrativeCheck {
  claimsChecked: number;
  unsupported: string[];
  passed: boolean;
  checkedText: "model" | "template";
}

export interface CaseFile {
  caseId: string;
  caseLabel: string;
  documents: CaseDocument[];

  inventory: { docId: string; kind: string; title: string; pages: number; unreadablePages: number[]; quarantinedLines: number }[];
  /** Line ranges excluded from citation because they look like instructions to an AI. */
  quarantine: { docId: string; page: number; line: number; text: string }[];
  flags: Flag[];

  drugs: DrugRecord[];
  fields: ExtractedField[];
  edges: GraphEdge[];
  conflicts: Conflict[];

  riskRank: { level: "routine" | "expedited" | "urgent"; reasons: string[] } | null;
  clock: Clock | null;
  validity: Validity | null;
  linkedCases: { caseId: string; reason: string }[];

  gaps: string[];
  followUpQuery: string | null;
  followUpLetter: string | null;

  route: Route | null;
  narrative: string | null;
  narrativeCheck: NarrativeCheck | null;
  codedEvent: { reported: string; pt: string; soc: string; origin: "dictionary" | "model-suggestion" } | null;

  halted: boolean;
  haltReason: string | null;
  haltAgent: string | null;

  reviews: Record<string, ReviewAction>;
  trace: TraceEntry[];
  modelCalls: ModelCallRecord[];
  /** "live" only when every model call this run succeeded. */
  mode: "live" | "degraded" | "seeded" | "mock";
  modelVersion: string | null;
}

export interface AgentResult {
  patch: Partial<CaseFile>;
  trace: Omit<TraceEntry, "seq" | "startedAt" | "durationMs">;
}
