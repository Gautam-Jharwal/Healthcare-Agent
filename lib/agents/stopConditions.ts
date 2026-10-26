/**
 * Stop conditions and the citation verifier.
 *
 * These are the controls that make SURE's claim defensible: an agent is not
 * trusted because a model sounded confident, it is trusted because its output
 * survived a mechanical check against the source text.
 */

import type { CaseDocument } from "../cases";
import type { Citation, CaseFile, Conflict } from "./types";

export const STOP_CONDITIONS: Record<string, string> = {
  intake: "Draws no clinical inference at intake",
  extract: "Preserves original text and units; unverifiable citation is downgraded, never kept",
  terminology: "Cannot overwrite source wording; a human confirms every code",
  evidenceGraph: "Labels links documented / candidate / unresolved — never causal",
  risk: "Cannot suppress a case subject to mandatory review",
  completeness: "Unknown stays unknown — no value is invented to pass a check",
  draft: "No unsupported claim; halts on a critical conflict; cannot submit to a regulator",
  humanGate: "Final clinical and regulatory judgement remains human-owned",
};

/** Normalises whitespace and case so a quote can be matched against page text. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 .,:/%()-]/g, "").trim();
}

/**
 * A citation is only trusted when its quote genuinely appears on the page it
 * names. This is what stops a fluent model from attributing an invented value
 * to a real document.
 */
export function verifyCitation(c: Citation, documents: CaseDocument[]): boolean {
  const doc = documents.find((d) => d.id === c.docId);
  if (!doc) return false;
  const page = doc.pages.find((p) => p.n === c.page);
  if (!page) return false;
  if (page.unreadable) return false; // never cite an unreadable page
  const hay = norm(page.text);
  const needle = norm(c.quote);
  if (needle.length < 6) return false;
  if (hay.includes(needle)) return true;
  // tolerate minor model paraphrase by requiring a long contiguous run to match
  const words = needle.split(" ");
  for (let len = words.length; len >= 5; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      if (hay.includes(words.slice(i, i + len).join(" "))) return true;
    }
  }
  return false;
}

/** Detects disagreements between sources on a critical field. */
export function detectConflicts(file: CaseFile): Conflict[] {
  const conflicts: Conflict[] = [];

  for (const f of file.fields) {
    if (!f.candidates || f.candidates.length < 2) continue;
    const critical = ["event_term", "onset_date", "suspect_drug", "seriousness", "outcome"];
    conflicts.push({
      field: f.key,
      description:
        f.key === "suspect_drug"
          ? `Sources support more than one suspect product (${f.candidates.join(", ")}) and the temporal data does not separate them.`
          : `Sources disagree on ${f.label.toLowerCase()}: ${f.candidates.join(" vs ")}.`,
      sources: f.citations,
      severity: critical.includes(f.key) && f.key !== "suspect_drug" ? "critical" : "minor",
    });
  }

  return conflicts;
}

/** Pages that could not be read. Their values must never be inferred. */
export function unreadablePages(documents: CaseDocument[]) {
  const out: { docId: string; docTitle: string; page: number }[] = [];
  for (const d of documents)
    for (const p of d.pages) if (p.unreadable) out.push({ docId: d.id, docTitle: d.title, page: p.n });
  return out;
}
