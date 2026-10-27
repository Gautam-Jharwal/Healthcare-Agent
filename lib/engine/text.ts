/**
 * Text utilities: sentence segmentation, date parsing, negation, regional-
 * language glosses, personal-identifier redaction and prompt-injection
 * quarantine. Everything here is deterministic and unit-testable.
 */

import type { CaseDocument, DocKind } from "../cases";

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const LONG_DATE = /\b(\d{1,2})\s+(?:of\s+)?(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{4})\b/i;
const SHORT_DATE = /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b(?!\s+\d{4})/i;
const NUMERIC_DATE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

export interface ParsedDate {
  iso: string;
  display: string;
  raw: string;
  ambiguous?: boolean;
  yearInferred?: boolean;
}

function mk(y: number, m: number, d: number, raw: string, extra: Partial<ParsedDate> = {}): ParsedDate | null {
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCMonth() !== m) return null;
  const iso = dt.toISOString().slice(0, 10);
  return { iso, display: `${d} ${MONTH_NAMES[m]} ${y}`, raw, ...extra };
}

/**
 * Parses the first date in a string.
 * Numeric dates are read as DD/MM (Indian convention) and marked ambiguous
 * when both parts are 12 or less, so a reviewer is told rather than surprised.
 */
export function parseDate(s: string, contextYear?: number): ParsedDate | null {
  let m = s.match(LONG_DATE);
  if (m) return mk(Number(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1]), m[0]);
  m = s.match(ISO_DATE);
  if (m) return mk(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[0]);
  m = s.match(NUMERIC_DATE);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    return mk(Number(m[3]), b - 1, a, m[0], { ambiguous: a <= 12 && b <= 12 && a !== b });
  }
  m = s.match(SHORT_DATE);
  if (m && contextYear) return mk(contextYear, MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1]), m[0], { yearInferred: true });
  return null;
}

export function findAllDates(s: string, contextYear?: number): ParsedDate[] {
  const out: ParsedDate[] = [];
  const res = [new RegExp(LONG_DATE, "gi"), new RegExp(NUMERIC_DATE, "g"), new RegExp(ISO_DATE, "g")];
  const covered: [number, number][] = [];
  for (const re of res) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const p = parseDate(m[0], contextYear);
      if (p) { out.push(p); covered.push([m.index, m.index + m[0].length]); }
    }
  }
  if (contextYear) {
    const re = new RegExp(SHORT_DATE, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const at = m.index;
      if (covered.some(([a, b]) => at >= a && at < b)) continue;
      const p = parseDate(m[0], contextYear);
      if (p) out.push(p);
    }
  }
  return out;
}

export function dayNumber(iso: string): number {
  return Date.parse(iso + "T00:00:00Z") / 86400000;
}

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso.slice(0, 10) + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

export function displayDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 .,:/%()^+-]/g, "")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Negation                                                            */
/* ------------------------------------------------------------------ */

/** True when the match at `index` sits inside a negated clause ("no rash", "did not require…"). */
export function isNegated(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 40), index).toLowerCase();
  const clause = before.split(/[.;:\n]|,\s*(?:but|and)\b/).pop() ?? "";
  return /\b(no|not|never|denies|denied|without|negative for|absence of|nor)\b[^,]*$/.test(clause);
}

/* ------------------------------------------------------------------ */
/* Regional-language glosses (Hinglish)                                 */
/* ------------------------------------------------------------------ */

/**
 * A small lexicon so seeded mode can read common Hinglish symptom phrases in
 * patient diaries. The original wording is always what gets cited; the gloss
 * is only used for matching and is shown to the reviewer.
 */
export const HINGLISH: { re: RegExp; gloss: string }[] = [
  { re: /neel[ae]?\s+nish(?:a|aa)n/i, gloss: "bruise" },
  { re: /\bkhujli\b/i, gloss: "itching" },
  { re: /\bdaan[ae]\b|\bdane\b/i, gloss: "rash" },
  { re: /\bulti\b/i, gloss: "vomiting" },
  { re: /\bchakkar\b/i, gloss: "dizziness" },
  { re: /\bbukhar\b/i, gloss: "fever" },
  { re: /gehra\s+peshab|peshab\s+gehra/i, gloss: "dark urine" },
  { re: /pet\s+(?:mein\s+)?dard/i, gloss: "abdominal pain" },
  { re: /\bthakaan\b|\bkamzori\b/i, gloss: "tiredness" },
  { re: /saans\s+(?:lene\s+mein\s+)?(?:takleef|dikkat)/i, gloss: "breathlessness" },
  { re: /\bsoojan\b/i, gloss: "swelling" },
  { re: /khoon\s+(?:aa|nikal)/i, gloss: "bleeding" },
  { re: /ghutne\s+mein\s+dard/i, gloss: "knee pain" },
];

export function glossHinglish(text: string): { glossed: string; used: { phrase: string; gloss: string }[] } {
  const used: { phrase: string; gloss: string }[] = [];
  let glossed = text;
  for (const h of HINGLISH) {
    const m = text.match(h.re);
    if (m) {
      used.push({ phrase: m[0], gloss: h.gloss });
      glossed += ` [${h.gloss}]`;
    }
  }
  return { glossed, used };
}

/* ------------------------------------------------------------------ */
/* Personal identifiers                                                */
/* ------------------------------------------------------------------ */

const PII_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "Aadhaar-like number", re: /(?<!\d)\d{4}\s\d{4}\s\d{4}(?!\d)/g },
  { kind: "mobile number", re: /(?<![\d,])(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?![\d,])/g },
  { kind: "PAN-like number", re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  { kind: "email address", re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g },
];

export function findPII(text: string): { kind: string; match: string }[] {
  const out: { kind: string; match: string }[] = [];
  for (const p of PII_PATTERNS) for (const m of text.matchAll(p.re)) out.push({ kind: p.kind, match: m[0] });
  return out;
}

export function redactPII(text: string): string {
  let t = text;
  for (const p of PII_PATTERNS) t = t.replace(p.re, (m) => "•".repeat(Math.max(0, m.length - 2)) + m.slice(-2));
  return t;
}

/* ------------------------------------------------------------------ */
/* Prompt injection                                                    */
/* ------------------------------------------------------------------ */

const INJECTION = [
  /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+instructions/i,
  /\b(?:system|developer)\s+prompt\b/i,
  /\bnote\s+to\s+(?:the\s+)?(?:ai|assistant|model|llm)\b/i,
  /\byou\s+are\s+(?:now\s+)?(?:an?|the)\s+(?:ai|assistant|model)\b/i,
  /\b(?:record|mark|classify|code|treat)\s+(?:this|the)\s+(?:case|event|report)\s+as\b/i,
  /\bdo\s+not\s+(?:report|submit|escalate)\b/i,
  /\bdisregard\b[^.\n]*\binstructions\b/i,
];

/** Returns the physical lines of a page that read like instructions addressed to an AI. */
export function findInjectionLines(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  text.split("\n").forEach((l, i) => {
    if (INJECTION.some((re) => re.test(l))) out.push({ line: i + 1, text: l.trim() });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Segmentation                                                        */
/* ------------------------------------------------------------------ */

export interface Snip {
  docId: string;
  docTitle: string;
  page: number;
  kind: DocKind;
  text: string;
  /** Lower-cased text with regional-language glosses appended, for matching only. */
  match: string;
  order: number;
}

const STARTS_NEW = /^(?:\s*[-•]\s+|\s*\d{1,2}\s+[A-Z][a-z]{2}\b|\s*[A-Z][A-Za-z /&()-]{1,40}:\s|\s*[A-Z][A-Z —-]{6,}$)/;

/**
 * Splits pages into sentence-sized snippets. A wrapped line is re-joined so a
 * fact split across two physical lines is still one quotable span.
 * Quarantined lines and unreadable pages are excluded.
 */
export function snippets(docs: CaseDocument[], quarantined: Set<string>): Snip[] {
  const out: Snip[] = [];
  let order = 0;
  for (const d of docs)
    for (const p of d.pages) {
      if (p.unreadable) continue;
      const lines = p.text.split("\n");
      const logical: string[] = [];
      lines.forEach((raw, i) => {
        if (quarantined.has(`${d.id}|${p.n}|${i + 1}`)) { logical.push(""); return; }
        const l = raw.replace(/\s+$/, "");
        if (!l.trim()) { logical.push(""); return; }
        const prev = logical.length ? logical[logical.length - 1] : "";
        const isLab = d.kind === "lab_report";
        if (!prev || isLab || STARTS_NEW.test(l)) logical.push(l.trim());
        else logical[logical.length - 1] = prev + " " + l.trim();
      });
      for (const block of logical) {
        if (!block) continue;
        // Diary entries and lab rows stay whole; narrative text splits into
        // sentences, but not after abbreviations or initials ("Dr. M. Iyer").
        const parts =
          d.kind === "lab_report" || d.kind === "patient_diary"
            ? [block]
            : block.split(/(?<!\b(?:Dr|Mr|Mrs|Ms|Prof|St|No|vs|approx|[A-Z])\.)(?<=[.;])\s+(?=[A-Z])/);
        for (const part of parts) {
          const t = part.replace(/\s{2,}/g, d.kind === "lab_report" ? "  " : " ").trim();
          if (!t) continue;
          const { glossed } = glossHinglish(t);
          out.push({ docId: d.id, docTitle: d.title, page: p.n, kind: d.kind, text: t, match: glossed.toLowerCase(), order: order++ });
        }
      }
    }
  return out;
}

export function docYear(d: CaseDocument): number {
  return new Date(d.received).getUTCFullYear();
}
