/** Shared state and trace types for the SURE agent graph. */

import type { CaseDocument } from "../cases";

export type FieldStatus = "sourced" | "gap" | "unknown" | "conflict";

export interface Citation {
  docId: string;
  docTitle: string;
  page: number;
  /** Verbatim span copied from the source page. Verified before it is trusted. */
  quote: string;
  /** Set by verifyCitation(); a citation that fails verification is never shown as Sourced. */
  verified?: boolean;
}

export interface ExtractedField {
  key: string;
  label: string;
  value: string | null;
  status: FieldStatus;
  /** Present when more than one value is defensible and none can be chosen. */
  candidates?: string[];
  citations: Citation[];
  /** Model self-reported confidence, shown but never treated as a probability. */
  confidence?: number;
  /** Set when a human has acted on the field. */
  reviewedBy?: string;
  reviewAction?: "accepted" | "corrected" | "marked_unknown";
  originalValue?: string | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: string;
  /** Never "causal". The product does not assert causality. */
  status: "documented" | "candidate" | "unresolved";
  note?: string;
}

export interface Conflict {
  field: string;
  description: string;
  sources: Citation[];
  severity: "critical" | "minor";
}

export interface ToolCall {
  tool: string;
  input: string;
  output: string;
}

export interface TraceEntry {
  seq: number;
  agent: string;
  agentLabel: string;
  startedAt: string;
  durationMs: number;
  summary: string;
  toolCalls: ToolCall[];
  /** The boundary this agent is required to check before handing off. */
  stopConditionChecked: string;
  stopTriggered: boolean;
  modelVersion: string | null;
  /**
   * Set when this agent intended to use the model but could not, e.g. the
   * provider was overloaded. Surfaced in the UI so a fallback is visible
   * rather than being mistaken for a configuration mistake.
   */
  fallbackReason?: string;
  outputKeys: string[];
}

export interface Approval {
  at: string;
  by: string;
  decision: "approved" | "rejected";
  note?: string;
}

export interface CaseFile {
  caseId: string;
  caseLabel: string;
  documents: CaseDocument[];

  /** Written by intake. */
  inventory: { docId: string; kind: string; pages: number; unreadablePages: number[] }[];

  /** Written by extract / terminology / completeness. */
  fields: ExtractedField[];

  /** Written by evidenceGraph. */
  edges: GraphEdge[];
  conflicts: Conflict[];

  /** Written by risk. */
  riskRank: { level: "routine" | "expedited" | "urgent"; reasons: string[] } | null;

  /** Written by completeness. */
  gaps: string[];
  followUpQuery: string | null;

  /** Written by draft. Null whenever the chain halted. */
  narrative: string | null;

  /** Set when a stop condition fired. */
  halted: boolean;
  haltReason: string | null;
  haltAgent: string | null;

  /** Human gate. */
  approvals: Approval[];
  exported: boolean;

  trace: TraceEntry[];
  mode: "live" | "seeded";
  modelVersion: string | null;
}

export interface AgentResult {
  patch: Partial<CaseFile>;
  trace: Omit<TraceEntry, "seq" | "startedAt" | "durationMs">;
}
