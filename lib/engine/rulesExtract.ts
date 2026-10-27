/**
 * Rule-based extractor.
 *
 * In seeded mode this is the only extractor. In live mode it runs alongside
 * the model as an independent second reader (the same idea as double data
 * entry in clinical data management): where the two disagree on a critical
 * field, a human decides.
 *
 * It parses the documents; it never reads the reference answers.
 */

import type { CaseDocument } from "../cases";
import { ICSR_FIELDS } from "../cases";
import type { Candidate, Citation, DrugRecord, Flag } from "./types";
import {
  parseDate, dayNumber, displayDate, isNegated, snippets, docYear, glossHinglish, type Snip, type ParsedDate,
} from "./text";
import {
  EVENT_LEXICON, symptomPatternFor, parseLabLine, describeLab, SERIOUSNESS_CRITERIA, NON_SERIOUS, type LabResult,
} from "./clinical";

export interface Proposal {
  value: string | null;
  candidates?: Candidate[];
  citations: Citation[];
  note?: string;
  warnings?: string[];
  /** true when sources assert different values on this field */
  conflict?: boolean;
}

export interface RuleExtraction {
  fields: Record<string, Proposal>;
  drugs: DrugRecord[];
  labs: LabResult[];
  flags: Flag[];
  eventEntry: (typeof EVENT_LEXICON)[number] | null;
  patientCode: string | null;
}

const cite = (s: Snip): Citation => ({ docId: s.docId, docTitle: s.docTitle, page: s.page, quote: s.text });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ONSET_TOLERANCE_DAYS = 3;

/* ------------------------------------------------------------------ */

function findEvent(s: Snip): { entry: (typeof EVENT_LEXICON)[number]; index: number } | null {
  let best: { entry: (typeof EVENT_LEXICON)[number]; index: number; len: number } | null = null;
  for (const entry of EVENT_LEXICON) {
    for (const t of [entry.term, ...(entry.aliases ?? [])]) {
      let from = 0;
      while (true) {
        const i = s.match.indexOf(t, from);
        if (i === -1) break;
        if (!isNegated(s.match, i)) {
          if (!best || i < best.index || (i === best.index && t.length > best.len)) best = { entry, index: i, len: t.length };
          break;
        }
        from = i + t.length;
      }
    }
  }
  return best ? { entry: best.entry, index: best.index } : null;
}

const DOSE_RE =
  /(\d[\d,.]*\s*(?:mg|mcg|µg|g|units|iu|ml))\b\s*,?\s*(oral|subcutaneous|intravenous|iv|sc|topical|inhaled)?\s*,?\s*((?:once|twice|three times|four times) daily|as required|every \d+ hours)?\s*,?\s*(oral|subcutaneous|intravenous|topical|inhaled)?/i;

function parseDose(text: string): string | null {
  const m = text.match(DOSE_RE);
  if (!m) return null;
  const route = m[2] ?? m[4];
  const freq = m[3];
  return `${m[1].replace(/\s+/g, " ")}${route ? " " + route.toLowerCase() : ""}${freq ? ", " + freq.toLowerCase() : ""}`;
}

const drugKey = (name: string) => name.toLowerCase().split(/\s+/).pop() ?? name.toLowerCase();

/* ------------------------------------------------------------------ */

export function extractWithRules(docs: CaseDocument[], quarantined: Set<string>): RuleExtraction {
  const snips = snippets(docs, quarantined);
  const year = docs.length ? docYear(docs[0]) : new Date().getUTCFullYear();
  const flags: Flag[] = [];
  const fields: Record<string, Proposal> = {};
  const clinical = snips.filter((s) => s.kind === "physician_note" || s.kind === "ae_form");

  /* ---------------- patient ---------------- */
  {
    const codeSnip = snips.find((s) => /patient code:\s*[A-Z0-9-]+/i.test(s.text));
    const code = codeSnip?.text.match(/patient code:\s*([A-Z0-9-]+[A-Z0-9])/i)?.[1] ?? null;
    const demoSnip = clinical.find((s) => /\b(female|male)\b[ ,]+(\d{1,3})\s*(?:years|yrs|y)\b/i.test(s.text));
    const dm = demoSnip?.text.match(/\b(female|male)\b[ ,]+(\d{1,3})\s*(?:years|yrs|y)\b/i);
    const parts = [code, dm ? `${cap(dm[1].toLowerCase())}, ${dm[2]} years` : null].filter(Boolean);
    const cites = [codeSnip, demoSnip].filter((x, i, a) => x && a.indexOf(x) === i).map((x) => cite(x!));
    fields.patient = parts.length
      ? { value: parts.join(" · "), citations: cites }
      : { value: null, citations: [], note: "No patient code, initials, age or sex found." };
  }
  const patientCode = fields.patient.value?.split(" · ")[0]?.match(/^[A-Z0-9-]+$/i) ? fields.patient.value!.split(" · ")[0] : null;

  /* ---------------- reporter ---------------- */
  {
    const rep = snips.find((s) => /^reporter(?: details)?:/i.test(s.text));
    const refused = rep && /not provided|unknown|not stated|none|anonymous/i.test(rep.text);
    if (rep && !refused) {
      const v = rep.text.replace(/^reporter(?: details)?:\s*/i, "").replace(/\.$/, "").trim();
      fields.reporter = { value: v, citations: [cite(rep)] };
    } else {
      const head = snips.find((s) => /^(investigator|haematology|hematology|physician|clinician)\b[a-z ]*note\s*[—-]\s*site\s*\d+/i.test(s.text));
      if (head && !refused) {
        const m = head.text.match(/^(investigator|haematology|hematology|physician|clinician)\b[a-z ]*note\s*[—-]\s*(site\s*\d+)/i)!;
        const role = /investigator/i.test(m[1]) ? "Investigator" : /haemat|hemat/i.test(m[1]) ? "Haematology team" : "Treating physician";
        fields.reporter = { value: `${role}, ${cap(m[2].toLowerCase())}`, citations: [cite(head)] };
      } else {
        fields.reporter = {
          value: null,
          citations: rep ? [cite(rep)] : [],
          note: refused ? "The source states reporter details were not provided." : "No reporter identified in the supplied documents.",
        };
      }
    }
  }

  /* ---------------- event ---------------- */
  let eventEntry: (typeof EVENT_LEXICON)[number] | null = null;
  {
    const ordered = [
      ...clinical.filter((s) => /^assessment:/i.test(s.text)),
      ...clinical.filter((s) => /^event:/i.test(s.text)),
      ...clinical,
      ...snips.filter((s) => s.kind === "lab_report" && /smear|comment/i.test(s.text)),
    ];
    for (const s of ordered) {
      const hit = findEvent(s);
      if (hit) {
        eventEntry = hit.entry;
        fields.event_term = { value: hit.entry.display, citations: [cite(s)] };
        break;
      }
    }
    if (!fields.event_term) fields.event_term = { value: null, citations: [], note: "No recognised adverse-event term found in clinical documents." };
  }

  /* ---------------- onset ---------------- */
  {
    type C = { date: ParsedDate; snip: Snip; who: "clinician" | "form" | "diary" };
    const cands: C[] = [];
    const warnings: string[] = [];
    for (const s of clinical) {
      const m = s.text.match(/(?:first noticed on(?: the evening of| the morning of)?|onset of symptoms recorded as|onset(?: date)?:|symptom onset:?)\s*([^.;]*)/i);
      if (m) {
        const d = parseDate(m[1], year);
        if (d) cands.push({ date: d, snip: s, who: s.kind === "ae_form" ? "form" : "clinician" });
      } else if (s.kind === "ae_form" && /^event:/i.test(s.text)) {
        const d = parseDate(s.text, year);
        if (d) cands.push({ date: d, snip: s, who: "form" });
      }
    }
    const symptom = symptomPatternFor(eventEntry?.display ?? null);
    const diary = snips
      .filter((s) => s.kind === "patient_diary" && /^\d{1,2}\s+[A-Z][a-z]{2}/.test(s.text))
      .find((s) => {
        const m = s.match.match(symptom);
        return m && m.index !== undefined && !isNegated(s.match, m.index);
      });
    if (diary) {
      const d = parseDate(diary.text, year);
      if (d) cands.push({ date: d, snip: diary, who: "diary" });
      const g = glossHinglish(diary.text);
      if (g.used.length)
        flags.push({
          code: "regional_language",
          severity: "info",
          message: `Patient diary read in Hinglish: ${g.used.map((u) => `"${u.phrase}" → ${u.gloss}`).join(", ")}. Original wording is what is cited.`,
          docId: diary.docId,
          page: diary.page,
        });
    }
    for (const c of cands)
      if (c.date.ambiguous) {
        const msg = `"${c.date.raw}" in ${c.snip.docTitle} read as DD/MM (${c.date.display}); MM/DD would give a different date.`;
        warnings.push(msg);
        flags.push({ code: "ambiguous_date_format", severity: "warn", message: msg, docId: c.snip.docId, page: c.snip.page });
      }

    const stated = cands.filter((c) => c.who !== "diary");
    const diaryC = cands.find((c) => c.who === "diary");
    const all = [...stated, ...(diaryC ? [diaryC] : [])];
    const days = all.map((c) => dayNumber(c.date.iso));
    const spread = days.length ? Math.max(...days) - Math.min(...days) : 0;
    const label = (c: C) => (c.who === "diary" ? `${c.date.display} (patient diary)` : c.who === "form" ? `${c.date.display} (AE form)` : `${c.date.display} (clinician)`);

    if (all.length >= 2 && spread > ONSET_TOLERANCE_DAYS) {
      const uniq = new Map<string, Candidate>();
      for (const c of all) {
        const k = c.date.iso + c.who;
        if (!uniq.has(k)) uniq.set(k, { value: label(c), citations: [cite(c.snip)] });
      }
      fields.onset_date = {
        value: null,
        conflict: true,
        candidates: [...uniq.values()],
        citations: all.map((c) => cite(c.snip)),
        note: `Sources disagree by ${spread} days (tolerance ${ONSET_TOLERANCE_DAYS}).`,
        warnings,
      };
    } else if (stated.length) {
      const first = stated.sort((a, b) => dayNumber(a.date.iso) - dayNumber(b.date.iso))[0];
      fields.onset_date = {
        value: first.date.display,
        citations: all.map((c) => cite(c.snip)),
        note: all.length > 1 ? `${all.length} sources agree within ${ONSET_TOLERANCE_DAYS} days.` : undefined,
        warnings,
      };
    } else if (diaryC) {
      const presented = clinical.find((s) => /presented on|admitted .* on/i.test(s.text));
      fields.onset_date = {
        value: diaryC.date.display,
        citations: [cite(diaryC.snip)],
        note:
          `Earliest documented symptom, from the patient diary. The diary does not write the year; ${year} is taken from the document's receipt date.` +
          (presented ? " The clinical note gives a presentation date, which is not an onset date." : ""),
        warnings,
      };
    } else {
      fields.onset_date = { value: null, citations: [], note: "No onset date stated in any source." };
    }
  }

  /* ---------------- medications ---------------- */
  const drugs: DrugRecord[] = [];
  {
    for (const s of clinical.filter((x) => /suspect product:/i.test(x.text))) {
      const after = s.text.replace(/.*suspect product:\s*/i, "");
      const name = after.split(/\s+\d|[,(.;]/)[0].trim();
      if (!name) continue;
      const docSnips = clinical.filter((x) => x.docId === s.docId);
      const startSnip = /commenced\s+\d/i.test(s.text) ? s : docSnips.find((x) => /therapy start:/i.test(x.text));
      const stopSnip = docSnips.find((x) => /therapy stop:/i.test(x.text));
      const startD = startSnip ? parseDate(startSnip.text.replace(/.*(?:therapy start:|commenced)/i, ""), year) : null;
      const stopD = stopSnip ? parseDate(stopSnip.text.replace(/.*therapy stop:/i, ""), year) : null;
      drugs.push({
        name: cap(name),
        dose: parseDose(after),
        start: startD?.display ?? null,
        stop: stopD?.display ?? null,
        longTerm: false,
        explicitSuspect: true,
        citations: [cite(s), ...(startSnip && startSnip !== s ? [cite(startSnip)] : [])],
        stopCitations: stopSnip ? [cite(stopSnip)] : [],
      });
    }
    for (const s of clinical.filter((x) => /^[-•]\s+[A-Z][a-z]+/.test(x.text) && /\d\s*(?:mg|mcg|units|iu|g)\b/i.test(x.text))) {
      const t = s.text.replace(/^[-•]\s+/, "");
      const name = t.split(/\s+\d/)[0].trim();
      if (drugs.some((d) => drugKey(d.name) === drugKey(name))) continue;
      const startD = /commenced\s+(.*)/i.test(t) ? parseDate(t.replace(/.*commenced\s+/i, ""), year) : null;
      drugs.push({
        name: cap(name),
        dose: parseDose(t),
        start: startD?.display ?? null,
        stop: null,
        longTerm: /long[- ]term|chronic|for years/i.test(t),
        explicitSuspect: false,
        citations: [cite(s)],
        stopCitations: [],
      });
    }
    // withdrawal statements anywhere in the clinical record
    for (const d of drugs) {
      const k = drugKey(d.name);
      const re = new RegExp(`\\b${k}\\b[^.;]*?\\b(?:was|were)?\\s*(?:discontinued|stopped|withdrawn|withheld)\\b|\\b(?:withhold|withdraw|stop|discontinue)\\s+(?:the\\s+)?${k}\\b`, "i");
      for (const s of clinical) {
        if (!re.test(s.text)) continue;
        if (!d.stopCitations.some((c) => c.quote === s.text)) d.stopCitations.push(cite(s));
        if (!d.stop) {
          const dd = parseDate(s.text.replace(new RegExp(`.*?${k}`, "i"), ""), year);
          if (dd) d.stop = dd.display;
        }
      }
    }
  }

  /* ---------------- suspect product and attribution ---------------- */
  const assessment = clinical.find((s) => /^assessment:/i.test(s.text));
  const explicit = drugs.filter((d) => d.explicitSuspect);
  let suspect: DrugRecord | null = null;
  let candidates: DrugRecord[] = [];
  const excluded: DrugRecord[] = [];
  if (explicit.length >= 1 && new Set(explicit.map((d) => drugKey(d.name))).size === 1) {
    suspect = explicit[0];
  } else if (explicit.length > 1) {
    candidates = explicit;
  } else {
    for (const d of drugs) (d.longTerm ? excluded : candidates).push(d);
    if (candidates.length === 1 && assessment && new RegExp(`\\b${drugKey(candidates[0].name)}\\b`, "i").test(assessment.text)) {
      suspect = candidates[0];
      candidates = [];
    }
  }

  if (suspect) {
    fields.suspect_drug = { value: suspect.name, citations: suspect.citations.slice(0, 1) };
  } else if (candidates.length) {
    fields.suspect_drug = {
      value: null,
      candidates: candidates.map((d) => ({ value: d.name, citations: d.citations, note: d.start ? `started ${d.start}` : undefined })),
      citations: candidates.flatMap((d) => d.citations),
      note:
        `${candidates.length} products are temporally plausible and the sources do not separate them.` +
        (excluded.length ? ` Excluded as long-term therapy predating the event: ${excluded.map((d) => d.name).join(", ")}.` : "") +
        " They can be reported as co-suspects if the reviewer decides so.",
    };
  } else {
    fields.suspect_drug = { value: null, citations: [], note: "No suspect or candidate product found." };
  }

  const perDrug = (pick: (d: DrugRecord) => string | null, label: string): Proposal => {
    if (suspect) {
      const v = pick(suspect);
      return v
        ? { value: v, citations: label === "stop" && suspect.stopCitations.length ? suspect.stopCitations.slice(0, 1) : suspect.citations }
        : {
            value: null,
            citations: label === "stop" ? suspect.stopCitations.slice(0, 1) : [],
            note:
              label === "stop" && suspect.stopCitations.length
                ? "Withdrawal of the suspect product is documented, but no date is given."
                : `Not stated for ${suspect.name}.`,
          };
    }
    const cs = candidates.filter((d) => pick(d)).map((d) => ({ value: `${d.name}: ${pick(d)}`, citations: d.citations }));
    return {
      value: null,
      candidates: cs.length ? cs : undefined,
      citations: [],
      note: candidates.length ? "Depends on which product is the suspect; held open until a reviewer decides." : "No suspect product identified.",
    };
  };
  fields.dose = perDrug((d) => d.dose, "dose");
  fields.therapy_start = perDrug((d) => d.start, "start");
  fields.therapy_stop = perDrug((d) => d.stop, "stop");

  /* ---------------- dechallenge / rechallenge ---------------- */
  {
    const IMPROVE = /began to fade|fade[sd]? |fully resolved|resolved after|recovered to|improvement after withdrawal|improved after|abated|subsided|returned to normal/i;
    const NEGATIVE = /persisted despite (?:discontinuation|withdrawal)|did not (?:resolve|improve) after (?:stopping|discontinuation|withdrawal)/i;
    if (suspect && suspect.stopCitations.length) {
      const stopQuote = suspect.stopCitations[0];
      const stopSnip = snips.find((s) => s.text === stopQuote.quote && s.docId === stopQuote.docId);
      const neg = clinical.find((s) => NEGATIVE.test(s.text));
      const imp = clinical.find(
        (s) =>
          IMPROVE.test(s.text) &&
          !/glucose tablets|after taking|after treatment with/i.test(s.text) &&
          (/after withdrawal|after stopping|after discontinuation/i.test(s.text) || (stopSnip && s.docId === stopSnip.docId && s.order >= stopSnip.order)),
      );
      if (neg) fields.dechallenge = { value: "Negative — event persisted after withdrawal", citations: [cite(neg), stopQuote] };
      else if (imp) fields.dechallenge = { value: "Positive — event abated after withdrawal", citations: [stopQuote, cite(imp)] };
      else fields.dechallenge = { value: null, citations: [stopQuote], note: "Withdrawal is documented but no change in the event is reported afterwards." };
    } else {
      fields.dechallenge = { value: null, citations: [], note: suspect ? "No withdrawal of the suspect product is documented." : "Depends on the suspect product." };
    }
    const re = clinical.find((s) => /\bno rechallenge\b|rechallenge (?:was )?not (?:attempted|performed|done)/i.test(s.text));
    const rePos = clinical.find((s) => /rechallenge[^.]*\b(?:recurr|reappear)/i.test(s.text));
    const reNeg = clinical.find((s) => /rechallenge[^.]*(?:no recurrence|did not recur)/i.test(s.text));
    fields.rechallenge = rePos
      ? { value: "Positive — event recurred", citations: [cite(rePos)] }
      : reNeg
        ? { value: "Negative — no recurrence", citations: [cite(reNeg)] }
        : re
          ? { value: "Not performed", citations: [cite(re)] }
          : { value: null, citations: [], note: "Rechallenge not mentioned." };
  }

  /* ---------------- seriousness ---------------- */
  {
    const found = new Map<string, Snip>();
    const nonSerious: Snip[] = [];
    for (const s of clinical) {
      for (const c of SERIOUSNESS_CRITERIA) {
        const m = s.text.match(c.re);
        if (m && m.index !== undefined && !isNegated(s.text, m.index) && !found.has(c.label)) found.set(c.label, s);
      }
      if (NON_SERIOUS.test(s.text)) nonSerious.push(s);
    }
    const labels = SERIOUSNESS_CRITERIA.map((c) => c.label).filter((l) => found.has(l));
    const cites = [...new Set(found.values())].map(cite);
    if (labels.length && nonSerious.length) {
      fields.seriousness = {
        value: null,
        conflict: true,
        candidates: [
          { value: `Serious — ${labels.join(", ")}`, citations: cites },
          { value: "Non-serious", citations: nonSerious.map(cite) },
        ],
        citations: [...cites, ...nonSerious.map(cite)],
        note: "Sources assert both serious criteria and non-seriousness.",
      };
    } else if (labels.length) {
      fields.seriousness = { value: `Serious — ${labels.join(", ")}`, citations: cites, note: "ICH E2A criteria as written in the source. SURE does not assess seriousness itself." };
    } else if (nonSerious.length) {
      fields.seriousness = { value: "Non-serious", citations: [cite(nonSerious[0])] };
    } else {
      fields.seriousness = { value: null, citations: [], note: "No seriousness criterion or statement in the sources." };
    }
  }

  /* ---------------- outcome ---------------- */
  {
    const mapOutcome = (t: string): string | null => {
      if (/\b(?:fatal|died|death)\b/i.test(t)) return "Fatal";
      if (/recovered with sequelae/i.test(t)) return "Recovered with sequelae";
      if (/not recovered|not resolved|ongoing|persist/i.test(t)) return "Not recovered";
      if (/recovering|improving|resolving/i.test(t)) return "Recovering";
      if (/recovered|resolved/i.test(t)) return "Recovered";
      return null;
    };
    const hits: { v: string; s: Snip }[] = [];
    for (const s of clinical.filter((x) => /^outcome:/i.test(x.text))) {
      const v = mapOutcome(s.text.replace(/^outcome:\s*/i, ""));
      if (v) hits.push({ v, s });
    }
    if (!hits.length)
      for (const s of clinical) {
        const m = s.text.match(/recovered without sequelae|patient recovered\b|\brecovering\b|\bpatient died\b|\bnot recovered\b/i);
        if (m && m.index !== undefined && !isNegated(s.text, m.index)) { const v = mapOutcome(m[0]); if (v) hits.push({ v, s }); }
      }
    const distinct = [...new Set(hits.map((h) => h.v))];
    if (distinct.length > 1) {
      fields.outcome = {
        value: null,
        conflict: true,
        candidates: distinct.map((v) => ({ value: v, citations: hits.filter((h) => h.v === v).map((h) => cite(h.s)) })),
        citations: hits.map((h) => cite(h.s)),
        note: "Sources record different outcomes.",
      };
    } else if (distinct.length === 1) {
      fields.outcome = { value: distinct[0], citations: hits.map((h) => cite(h.s)) };
    } else {
      fields.outcome = { value: null, citations: [], note: "Outcome not recorded at the time of reporting." };
    }
  }

  /* ---------------- laboratory ---------------- */
  const labs: LabResult[] = [];
  for (const s of snips.filter((x) => x.kind === "lab_report")) {
    const r = parseLabLine(s.text, cite(s));
    if (r) labs.push(r);
  }
  {
    const abnormal = labs.filter((r) => r.abnormal);
    fields.relevant_lab = abnormal.length
      ? { value: abnormal.map(describeLab).join("; "), citations: abnormal.map((r) => r.citation) }
      : labs.length
        ? { value: "No abnormal values in the supplied reports", citations: labs.slice(0, 1).map((r) => r.citation) }
        : { value: null, citations: [], note: "No laboratory report supplied." };
  }

  /* ---------------- concomitant ---------------- */
  {
    const cm = clinical.find((s) => /concomitant medications?:/i.test(s.text));
    const parts: string[] = [];
    const cites: Citation[] = [];
    if (cm) {
      const v = cm.text.replace(/.*concomitant medications?:\s*/i, "").replace(/\.$/, "").trim();
      parts.push(/^none\b/i.test(v) ? "None" : v);
      cites.push(cite(cm));
    }
    for (const d of excluded) {
      parts.push(`${d.name}${d.dose ? " " + d.dose : ""} (long-term)`);
      cites.push(...d.citations);
    }
    fields.concomitant = parts.length
      ? { value: parts.filter((p, i) => !(p === "None" && parts.length > 1) || i === 0).join("; "), citations: cites }
      : { value: null, citations: [], note: "Concomitant medication not documented." };
  }

  for (const f of ICSR_FIELDS) if (!fields[f.key]) fields[f.key] = { value: null, citations: [] };

  return { fields, drugs, labs, flags, eventEntry, patientCode };
}

export { displayDate };
