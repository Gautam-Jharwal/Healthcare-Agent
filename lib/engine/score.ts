/**
 * Scores a finished case file against its hand-written reference answer.
 * Used by the /eval page, scripts/eval.ts and eval/run_eval.py (via /api/eval).
 *
 * Every field is scored, not only the critical ones, and the reference can say
 * "null" — meaning the correct behaviour is to NOT assert a value.
 */

import { ICSR_FIELDS, type CaseBundle, type RefValue } from "../cases";
import type { CaseFile } from "./types";
import { parseDate, norm } from "./text";

export interface FieldScore {
  key: string;
  label: string;
  critical: boolean;
  expected: RefValue;
  got: string | null;
  status: string;
  correct: boolean;
}

export interface CaseScore {
  caseId: string;
  label: string;
  set: string;
  mode: string;
  fields: FieldScore[];
  allCorrect: number;
  allTotal: number;
  critCorrect: number;
  critTotal: number;
  unsupported: number;
  asserted: number;
  gapHits: number;
  gapExpected: number;
  gapFalse: number;
  routeOk: boolean;
  route: string | null;
  expectedRoute: string;
  riskOk: boolean;
  risk: string | null;
  expectedRisk: string;
  validOk: boolean;
  flagsExpected: string[];
  flagsFound: string[];
  modelCitationsRejected: number;
  narrativeClaims: number;
  narrativeUnsupported: number;
  ms: number;
}

export function matches(expected: RefValue, got: string | null, year: number): boolean {
  if (expected === null) return got === null;
  if (got === null) return false;
  if (typeof expected === "string" && /^\d{4}-\d{2}-\d{2}$/.test(expected)) return parseDate(got, year)?.iso === expected;
  const g = norm(got);
  const toks = Array.isArray(expected) ? expected : [expected];
  return toks.every((t) => g.includes(norm(t)));
}

export function scoreCase(bundle: CaseBundle, f: CaseFile, ms = 0): CaseScore | null {
  const ref = bundle.reference;
  if (!ref) return null;
  const year = new Date(bundle.documents[0].received).getUTCFullYear();
  const fields: FieldScore[] = ICSR_FIELDS.map((spec) => {
    const got = f.fields.find((x) => x.key === spec.key);
    const expected = ref.fields[spec.key] ?? null;
    const value = got?.value ?? null;
    return { key: spec.key, label: spec.label, critical: spec.critical, expected, got: value, status: got?.status ?? "missing", correct: matches(expected, value, year) };
  });
  const asserted = f.fields.filter((x) => x.value);
  const unsupported = asserted.filter((x) => x.status === "sourced" && !x.citations.length).length;
  const gapSet = new Set(f.gaps);
  const flagsFound = [...new Set(f.flags.map((x) => x.code))];
  return {
    caseId: bundle.id,
    label: bundle.label,
    set: bundle.set,
    mode: f.mode,
    fields,
    allCorrect: fields.filter((x) => x.correct).length,
    allTotal: fields.length,
    critCorrect: fields.filter((x) => x.critical && x.correct).length,
    critTotal: fields.filter((x) => x.critical).length,
    unsupported,
    asserted: asserted.length,
    gapHits: ref.expectedGaps.filter((g) => gapSet.has(g)).length,
    gapExpected: ref.expectedGaps.length,
    gapFalse: f.gaps.filter((g) => !ref.expectedGaps.includes(g)).length,
    routeOk: f.route === ref.expectedRoute,
    route: f.route,
    expectedRoute: ref.expectedRoute,
    riskOk: f.riskRank?.level === ref.expectedRisk,
    risk: f.riskRank?.level ?? null,
    expectedRisk: ref.expectedRisk,
    validOk: (f.validity?.valid ?? false) === ref.expectedValid,
    flagsExpected: ref.expectedFlags ?? [],
    flagsFound,
    modelCitationsRejected: f.trace.find((t) => t.agent === "extract")?.toolCalls.find((t) => t.tool === "verify_citations")?.output.match(/(\d+) rejected/)?.[1] ? Number(f.trace.find((t) => t.agent === "extract")!.toolCalls.find((t) => t.tool === "verify_citations")!.output.match(/(\d+) rejected/)![1]) : 0,
    narrativeClaims: f.narrativeCheck?.claimsChecked ?? 0,
    narrativeUnsupported: f.narrativeCheck?.unsupported.length ?? 0,
    ms,
  };
}

export interface Totals {
  cases: number;
  allCorrect: number;
  allTotal: number;
  critCorrect: number;
  critTotal: number;
  unsupported: number;
  asserted: number;
  gapHits: number;
  gapExpected: number;
  gapFalse: number;
  routeOk: number;
  riskOk: number;
  validOk: number;
  flagsHit: number;
  flagsExpected: number;
}

export function totals(scores: CaseScore[]): Totals {
  const t: Totals = { cases: 0, allCorrect: 0, allTotal: 0, critCorrect: 0, critTotal: 0, unsupported: 0, asserted: 0, gapHits: 0, gapExpected: 0, gapFalse: 0, routeOk: 0, riskOk: 0, validOk: 0, flagsHit: 0, flagsExpected: 0 };
  for (const s of scores) {
    t.cases++;
    t.allCorrect += s.allCorrect; t.allTotal += s.allTotal;
    t.critCorrect += s.critCorrect; t.critTotal += s.critTotal;
    t.unsupported += s.unsupported; t.asserted += s.asserted;
    t.gapHits += s.gapHits; t.gapExpected += s.gapExpected; t.gapFalse += s.gapFalse;
    t.routeOk += Number(s.routeOk); t.riskOk += Number(s.riskOk); t.validOk += Number(s.validOk);
    t.flagsHit += s.flagsExpected.filter((x) => s.flagsFound.includes(x)).length;
    t.flagsExpected += s.flagsExpected.length;
  }
  return t;
}
