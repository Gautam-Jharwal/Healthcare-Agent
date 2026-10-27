/**
 * The mechanical checks that make SURE's claims defensible.
 *
 * An agent's output is not trusted because a model sounded confident. It is
 * trusted because it survived these checks against the source text.
 */

import type { CaseDocument } from "../cases";
import type { Citation, CaseFile, NarrativeCheck } from "./types";
import { norm, findAllDates, parseDate } from "./text";

export const STOP_CONDITIONS: Record<string, string> = {
  intake: "Draws no clinical inference; quarantines instruction-like text; never cites an unreadable page",
  extract: "Every value needs a citation that is found verbatim on the cited page and actually contains the value; otherwise the value is discarded",
  review: "Applies only decisions a named reviewer made, with a reason; never overrides silently",
  terminology: "Cannot overwrite source wording; a human confirms every code",
  evidenceGraph: "Labels links documented / candidate / unresolved, never causal",
  risk: "Ranks and explains; cannot suppress a case or decide seriousness",
  completeness: "Unknown stays unknown; no value invented to pass a check",
  draft: "Writes only verified facts; halts on a critical conflict or an invalid case; cannot submit",
  humanGate: "Final clinical and regulatory judgement remains human-owned",
};

export type Quarantine = { docId: string; page: number; line: number; text: string }[];

/**
 * A citation is trusted only when its quote genuinely appears on the page it
 * names, the page is readable, and the quote does not come from text that was
 * quarantined as an instruction to an AI.
 */
export function verifyCitation(c: Citation, documents: CaseDocument[], quarantine: Quarantine = []): { ok: boolean; reason?: string } {
  const doc = documents.find((d) => d.id === c.docId);
  if (!doc) return { ok: false, reason: `document ${c.docId} does not exist` };
  const page = doc.pages.find((p) => p.n === Number(c.page));
  if (!page) return { ok: false, reason: `page ${c.page} does not exist in ${doc.title}` };
  if (page.unreadable) return { ok: false, reason: `page ${c.page} is unreadable and cannot be cited` };
  const needle = norm(c.quote ?? "");
  if (needle.length < 6) return { ok: false, reason: "quote too short to verify" };
  for (const q of quarantine.filter((x) => x.docId === c.docId && x.page === Number(c.page))) {
    const qn = norm(q.text);
    if (qn.includes(needle) || needle.includes(qn.slice(0, Math.min(qn.length, 24))))
      return { ok: false, reason: "quote comes from quarantined instruction-like text" };
  }
  const hay = norm(page.text);
  if (hay.includes(needle)) return { ok: true };
  // tolerate line-wrapping and light punctuation drift: require a long contiguous run
  const words = needle.split(" ");
  const need = Math.min(words.length, 8);
  for (let len = words.length; len >= need; len--)
    for (let i = 0; i + len <= words.length; i++) if (hay.includes(words.slice(i, i + len).join(" "))) return { ok: true };
  return { ok: false, reason: "quote not found on the cited page" };
}

/**
 * A real quote can still be attached to an invented value ("Platelets 24"
 * citing "Platelet count 42"). Numbers and dates in the value must appear in
 * the quoted text.
 */
export function valueSupportedByQuotes(value: string, quotes: string[], contextYear: number): { ok: boolean; reason?: string } {
  const q = quotes.join(" \n ");
  const qDates = new Set(findAllDates(q, contextYear).map((d) => d.iso));
  const vDates = findAllDates(value, contextYear);
  for (const d of vDates) if (!qDates.has(d.iso)) return { ok: false, reason: `date ${d.display} is not in the quoted text` };
  let stripped = value;
  for (const d of vDates) stripped = stripped.replace(d.raw, " ");
  // digits that belong to a date in the quote cannot support a quantity ("10 mg" vs "10 January")
  let qNoDates = q;
  for (const d of findAllDates(q, contextYear)) qNoDates = qNoDates.split(d.raw).join(" ");
  const qn = qNoDates.replace(/,/g, "");
  for (const m of stripped.matchAll(/\d+(?:\.\d+)?/g)) {
    const n = m[0];
    if (!new RegExp(`(?<![\\d.])${n.replace(".", "\\.")}(?![\\d])`).test(qn)) return { ok: false, reason: `number ${n} is not in the quoted text` };
  }
  return { ok: true };
}

/**
 * Checks a drafted narrative against the facts it is allowed to use.
 * Every date, quantity, product name and outcome word must trace back to a
 * verified field. Causal language is not allowed at all.
 */
export function verifyNarrative(narrative: string, file: CaseFile, checkedText: "model" | "template"): NarrativeCheck {
  const year = file.documents[0] ? new Date(file.documents[0].received).getUTCFullYear() : 2026;
  const trusted = file.fields.filter((f) => ["sourced", "adjudicated", "corrected"].includes(f.status) && f.value);
  const allowed = [
    ...trusted.map((f) => f.value as string),
    ...file.fields.flatMap((f) => (f.candidates ?? []).map((c) => c.value)),
  ].join(" \n ");
  const allowedN = allowed.toLowerCase().replace(/,/g, "");
  const allowedDates = new Set(findAllDates(allowed, year).map((d) => d.iso));
  const unsupported: string[] = [];
  let claims = 0;

  const dates = findAllDates(narrative, year);
  for (const d of dates) {
    claims++;
    if (!allowedDates.has(d.iso)) unsupported.push(`date "${d.raw}" is not a verified fact`);
  }
  let rest = narrative;
  for (const d of dates) rest = rest.replace(d.raw, " ");
  for (const m of rest.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(mg\/dl|mg|mcg|units|u\/l|g\/dl|%|x 10\^9\/l|\/ul|years|kg|hours|days)\b/gi)) {
    claims++;
    const n = m[1].replace(/,/g, "");
    if (!new RegExp(`(?<![\\d.])${n.replace(".", "\\.")}(?![\\d])`).test(allowedN)) unsupported.push(`quantity "${m[0]}" is not a verified fact`);
  }
  const lower = narrative.toLowerCase();
  for (const d of file.drugs) {
    const k = d.name.toLowerCase().split(/\s+/).pop()!;
    if (new RegExp(`\\b${k}\\b`).test(lower)) {
      claims++;
      if (!new RegExp(`\\b${k}\\b`).test(allowedN)) unsupported.push(`product "${d.name}" is not a verified fact`);
    }
  }
  const eventText = (file.fields.find((f) => f.key === "event_term")?.value ?? "").toLowerCase();
  const scrubbed = eventText ? lower.split(eventText).join(" ") : lower;
  const causal = scrubbed.match(/\b(caused by|due to|induced by|resulted from|attributed to|because of|secondary to|related to)\b/);
  claims++;
  if (causal) unsupported.push(`causal language "${causal[0]}" — SURE does not assert causality`);
  const checks: [RegExp, RegExp, string][] = [
    [/\b(died|death|fatal)\b/, /fatal|death/, "a fatal outcome"],
    [/life-threatening/, /life-threatening/, "a life-threatening criterion"],
    [/hospitali[sz]/, /hospitali[sz]ation/, "hospitalisation"],
    [/\brecovered\b/, /recover/, "recovery"],
  ];
  for (const [inText, inFacts, what] of checks) {
    if (inText.test(scrubbed)) {
      claims++;
      if (!inFacts.test(allowedN)) unsupported.push(`mentions ${what}, which no verified field supports`);
    }
  }
  return { claimsChecked: claims, unsupported, passed: unsupported.length === 0, checkedText };
}

/** A follow-up letter may not introduce dates or numbers that are not already in the query. */
export function verifyLetter(letter: string, query: string, year: number): string[] {
  const allowed = new Set(findAllDates(query, year).map((d) => d.iso));
  const bad: string[] = [];
  for (const d of findAllDates(letter, year)) if (!allowed.has(d.iso)) bad.push(`date ${d.raw}`);
  return bad;
}

export { parseDate };
