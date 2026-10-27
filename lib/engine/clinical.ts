/**
 * Clinical rule sets used by the agents. Each rule is named, versioned and
 * explainable, so a reviewer can see exactly why a case was ranked or flagged.
 *
 * These are review aids. None of them assesses causality, expectedness or
 * seriousness on a reviewer's behalf.
 */

import type { Citation, Flag } from "./types";

export const RULESET_VERSION = "SURE-rules 0.3 (illustrative, pending PV SME validation)";

/* ------------------------------------------------------------------ */
/* Event terminology — an illustrative subset, not the MedDRA dictionary */
/* ------------------------------------------------------------------ */

export const EVENT_LEXICON: { term: string; display: string; pt: string; soc: string; aliases?: string[] }[] = [
  { term: "heparin-induced thrombocytopenia", display: "Heparin-induced thrombocytopenia", pt: "Heparin-induced thrombocytopenia", soc: "Blood and lymphatic system disorders" },
  { term: "drug-induced liver injury", display: "Drug-induced liver injury", pt: "Drug-induced liver injury", soc: "Hepatobiliary disorders" },
  { term: "stevens-johnson syndrome", display: "Stevens-Johnson syndrome", pt: "Stevens-Johnson syndrome", soc: "Skin and subcutaneous tissue disorders" },
  { term: "toxic epidermal necrolysis", display: "Toxic epidermal necrolysis", pt: "Toxic epidermal necrolysis", soc: "Skin and subcutaneous tissue disorders" },
  { term: "anaphylaxis", display: "Anaphylaxis", pt: "Anaphylactic reaction", soc: "Immune system disorders", aliases: ["anaphylactic reaction"] },
  { term: "angioedema", display: "Angioedema", pt: "Angioedema", soc: "Skin and subcutaneous tissue disorders" },
  { term: "thrombocytopenia", display: "Thrombocytopenia", pt: "Thrombocytopenia", soc: "Blood and lymphatic system disorders" },
  { term: "agranulocytosis", display: "Agranulocytosis", pt: "Agranulocytosis", soc: "Blood and lymphatic system disorders" },
  { term: "neutropenia", display: "Neutropenia", pt: "Neutropenia", soc: "Blood and lymphatic system disorders" },
  { term: "hypoglycaemia", display: "Hypoglycaemia", pt: "Hypoglycaemia", soc: "Metabolism and nutrition disorders", aliases: ["hypoglycemia"] },
  { term: "hyperkalaemia", display: "Hyperkalaemia", pt: "Hyperkalaemia", soc: "Metabolism and nutrition disorders", aliases: ["hyperkalemia"] },
  { term: "lactic acidosis", display: "Lactic acidosis", pt: "Lactic acidosis", soc: "Metabolism and nutrition disorders" },
  { term: "acute kidney injury", display: "Acute kidney injury", pt: "Acute kidney injury", soc: "Renal and urinary disorders" },
  { term: "pancreatitis", display: "Pancreatitis", pt: "Pancreatitis", soc: "Gastrointestinal disorders" },
  { term: "rhabdomyolysis", display: "Rhabdomyolysis", pt: "Rhabdomyolysis", soc: "Musculoskeletal and connective tissue disorders" },
  { term: "qt prolongation", display: "QT prolongation", pt: "Electrocardiogram QT prolonged", soc: "Investigations" },
  { term: "hepatotoxicity", display: "Hepatotoxicity", pt: "Hepatotoxicity", soc: "Hepatobiliary disorders" },
  { term: "jaundice", display: "Jaundice", pt: "Jaundice", soc: "Hepatobiliary disorders" },
  { term: "seizure", display: "Seizure", pt: "Seizure", soc: "Nervous system disorders" },
  { term: "bradycardia", display: "Bradycardia", pt: "Bradycardia", soc: "Cardiac disorders" },
  { term: "urticaria", display: "Urticaria", pt: "Urticaria", soc: "Skin and subcutaneous tissue disorders", aliases: ["hives"] },
  { term: "rash", display: "Rash", pt: "Rash", soc: "Skin and subcutaneous tissue disorders" },
];

/** Symptoms that can mark the onset of each kind of event. Used to read diaries. */
export function symptomPatternFor(eventTerm: string | null): RegExp {
  const e = (eventTerm ?? "").toLowerCase();
  if (/thrombocyt|platelet|bleed/.test(e)) return /bruis|bleed|gums bled|petechi|purpur/;
  if (/liver|hepat|jaundice/.test(e)) return /\bsick\b|queasy|nause|dark(?:er)? (?:than usual|urine)|urine looked darker|yellow|jaundice|ache under the right ribs/;
  if (/urticaria|rash|hive/.test(e)) return /rash|bump|itch|hive|welt/;
  if (/angioedema|anaphyla/.test(e)) return /swell|swollen|breath|wheez/;
  if (/stevens|necrolysis/.test(e)) return /rash|blister|fever|sore mouth|ulcer|peel/;
  if (/hypoglyc/.test(e)) return /shak|sweat|dizz|faint|confus/;
  return /rash|itch|bruis|bleed|\bsick\b|queasy|nause|vomit|dizz|swell|fever|blister|breath/;
}

/* ------------------------------------------------------------------ */
/* Laboratory parsing and alerts                                        */
/* ------------------------------------------------------------------ */

export interface LabResult {
  name: string;
  value: number;
  valueText: string;
  unit: string;
  lo: number;
  hi: number;
  flag: string | null;
  abnormal: boolean;
  citation: Citation;
  /** Platelets and white cells normalised to 10^9/L where needed. */
  normalised?: { value: number; unit: string };
}

const LAB_LINE =
  /^\s*([A-Za-z][A-Za-z ()/.-]*?[A-Za-z)])\s+(\d[\d,]*\.?\d*)\s*([^(]*?)\s*\(ref\s+([\d,.]+)\s*-\s*([\d,.]+)[^)]*\)\s*(CRITICAL LOW|CRITICAL HIGH|HIGH|LOW)?\s*$/i;

const num = (s: string) => Number(s.replace(/,/g, ""));

export function parseLabLine(line: string, cite: Citation): LabResult | null {
  const m = line.match(LAB_LINE);
  if (!m) return null;
  const value = num(m[2]);
  const lo = num(m[4]);
  const hi = num(m[5]);
  const flag = m[6] ? m[6].toUpperCase() : null;
  const unit = m[3].trim();
  const abnormal = !!flag || value < lo || value > hi;
  const r: LabResult = { name: m[1].trim(), value, valueText: m[2], unit, lo, hi, flag, abnormal, citation: cite };
  if (/platelet|wbc|neutrophil/i.test(r.name) && /\/u?l|\/mm3|\/µl/i.test(unit) && value > 1000) {
    r.normalised = { value: Math.round((value / 1000) * 10) / 10, unit: "x 10^9/L" };
  } else if (/platelet|wbc|neutrophil/i.test(r.name) && /10\^9/.test(unit)) {
    r.normalised = { value, unit: "x 10^9/L" };
  }
  return r;
}

export function describeLab(r: LabResult): string {
  const flag = r.flag ? ` (${r.flag.toLowerCase()})` : r.abnormal ? " (outside reference range)" : "";
  const norm = r.normalised && !/10\^9/.test(r.unit) ? `, ≈${r.normalised.value} x 10^9/L` : "";
  return `${r.name} ${r.valueText} ${r.unit}${flag}${norm}`.replace(/\s+/g, " ").trim();
}

/** Named laboratory rules. Each produces a flag with its arithmetic shown. */
export function labAlerts(results: LabResult[]): Flag[] {
  const flags: Flag[] = [];
  const by = (re: RegExp) => results.find((r) => re.test(r.name));
  const plt = by(/platelet/i);
  if (plt) {
    const v = plt.normalised?.value ?? plt.value;
    if (v < 50) flags.push({ code: "severe_thrombocytopenia", severity: "critical", message: `Platelets ${v} x 10^9/L, below the 50 x 10^9/L severe-thrombocytopenia threshold.`, docId: plt.citation.docId, page: plt.citation.page });
  }
  const alt = by(/\balt\b|sgpt/i);
  const ast = by(/\bast\b|sgot/i);
  const bili = by(/bilirubin/i);
  const xULN = (r?: LabResult) => (r && r.hi > 0 ? r.value / r.hi : 0);
  const amin = Math.max(xULN(alt), xULN(ast));
  if (amin > 3 && xULN(bili) > 2) {
    flags.push({
      code: "hys_law",
      severity: "critical",
      message: `Potential Hy's law pattern: aminotransferase ${amin.toFixed(1)}× ULN (>3×) with total bilirubin ${xULN(bili).toFixed(1)}× ULN (>2×). A medically important event candidate; alkaline phosphatase must be checked before the pattern is confirmed.`,
      docId: bili!.citation.docId,
      page: bili!.citation.page,
    });
  } else if (amin > 5) {
    flags.push({ code: "lab_alert", severity: "warn", message: `Aminotransferase ${amin.toFixed(1)}× ULN (>5×).` });
  }
  const k = by(/potassium/i);
  if (k && k.value > 6) flags.push({ code: "lab_alert", severity: "warn", message: `Potassium ${k.value} above 6.0.` });
  const inr = by(/\binr\b/i);
  if (inr && inr.value > 1.5) flags.push({ code: "lab_alert", severity: "warn", message: `INR ${inr.value} above 1.5.` });
  return flags;
}

/* ------------------------------------------------------------------ */
/* Seriousness (ICH E2A criteria) and reporting clock                   */
/* ------------------------------------------------------------------ */

export const SERIOUSNESS_CRITERIA: { key: string; label: string; re: RegExp }[] = [
  { key: "death", label: "death", re: /\b(?:died|death|fatal)\b/i },
  { key: "life_threatening", label: "life-threatening", re: /life[- ]threatening/i },
  { key: "hospitalisation", label: "hospitalisation", re: /\b(?:admitted|admission|hospitali[sz](?:ed|ation)|burns unit|intensive care)\b/i },
  { key: "disability", label: "disability", re: /persistent (?:or significant )?disability|significant incapacity/i },
  { key: "congenital", label: "congenital anomaly", re: /congenital anomaly|birth defect/i },
];

export const NON_SERIOUS = /\bnon-serious\b|did not require (?:hospitali[sz]ation|admission)|not serious/i;

/**
 * Expedited reporting clock. ICH E2A sets 7 calendar days for fatal or
 * life-threatening unexpected reactions in clinical trials and 15 days for
 * other serious unexpected reactions. National timelines (e.g. India's NDCT
 * Rules, 2019) differ and are configured per customer.
 */
export function reportingClock(seriousLabels: string[]): { days: number | null; rule: string } {
  if (seriousLabels.some((s) => /death|life-threatening/.test(s)))
    return { days: 7, rule: "ICH E2A — fatal or life-threatening: 7 calendar days" };
  if (seriousLabels.length) return { days: 15, rule: "ICH E2A — other serious: 15 calendar days" };
  return { days: null, rule: "Non-serious — no expedited clock; periodic reporting" };
}
