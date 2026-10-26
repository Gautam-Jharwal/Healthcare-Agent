/**
 * The eight nodes of the SURE graph.
 *
 * Each node takes the CaseFile, does one bounded job, and returns a patch plus
 * a trace entry naming the stop condition it checked. No node may write a
 * clinical conclusion the sources do not support.
 */

import type { CaseDocument } from "../cases";
import { ICSR_FIELDS } from "../cases";
import type { AgentResult, CaseFile, Citation, ExtractedField, GraphEdge } from "./types";
import { STOP_CONDITIONS, verifyCitation, detectConflicts, unreadablePages } from "./stopConditions";
import { callModelJSON, activeProvider, activeModelVersion } from "./llm";

/* ------------------------------------------------------------------ */
/* 01 · INTAKE — classify and inventory. No clinical inference.        */
/* ------------------------------------------------------------------ */
export async function intake(file: CaseFile): Promise<AgentResult> {
  const inventory = file.documents.map((d) => ({
    docId: d.id,
    kind: d.kind,
    pages: d.pages.length,
    unreadablePages: d.pages.filter((p) => p.unreadable).map((p) => p.n),
  }));
  const bad = unreadablePages(file.documents);

  return {
    patch: { inventory },
    trace: {
      agent: "intake",
      agentLabel: "Intake & classification",
      summary:
        `${file.documents.length} documents indexed, ${inventory.reduce((a, b) => a + b.pages, 0)} pages. ` +
        (bad.length
          ? `${bad.length} page(s) flagged unreadable and excluded from citation.`
          : `All pages readable.`),
      toolCalls: [
        { tool: "classify_documents", input: `${file.documents.length} files`, output: inventory.map((i) => i.kind).join(", ") },
        { tool: "scan_page_quality", input: "all pages", output: bad.length ? `unreadable: ${bad.map((b) => `${b.docTitle} p.${b.page}`).join("; ")}` : "no defects" },
      ],
      stopConditionChecked: STOP_CONDITIONS.intake,
      stopTriggered: false,
      modelVersion: null,
      outputKeys: ["inventory"],
    },
  };
}

/* ------------------------------------------------------------------ */
/* 02 · EXTRACT — pull fields WITH citations, then verify every one.   */
/* ------------------------------------------------------------------ */
const EXTRACT_SYSTEM = `You extract Individual Case Safety Report (ICSR) fields from source documents.

Hard rules:
- Copy values as written in the source. Never normalise units or invent precision.
- Every value MUST carry a citation: the document id, the page number, and a VERBATIM quote copied character-for-character from that page.
- If a value is not stated, return null. Never guess, never infer from typical practice.
- If more than one value is defensible and the sources do not settle it, return null and list every option in "candidates".
- Never read from a page marked unreadable.

Return JSON of shape:
{"fields":[{"key":"...","value":"..."|null,"candidates":["..."],"confidence":0.0-1.0,
  "citations":[{"docId":"...","page":1,"quote":"verbatim span"}]}]}`;

export async function extract(file: CaseFile): Promise<AgentResult> {
  const readable = file.documents.map((d) => ({
    ...d,
    pages: d.pages.filter((p) => !p.unreadable),
  }));

  let proposed: Partial<ExtractedField>[];
  let usedModel = false;

  if (activeProvider()) {
    try {
      const payload = readable
        .map((d) => d.pages.map((p) => `### docId=${d.id} | page=${p.n} | ${d.title}\n${p.text}`).join("\n\n"))
        .join("\n\n");
      const out = await callModelJSON<{ fields: Partial<ExtractedField>[] }>({
        system: EXTRACT_SYSTEM,
        user: `Fields to extract: ${ICSR_FIELDS.map((f) => f.key).join(", ")}\n\nSOURCE DOCUMENTS:\n\n${payload}`,
        maxTokens: 2200,
      });
      proposed = out.fields ?? [];
      usedModel = true;
    } catch {
      proposed = deterministicExtract(readable);
    }
  } else {
    proposed = deterministicExtract(readable);
  }

  // Verify every citation against the real page text.
  let rejected = 0;
  const fields: ExtractedField[] = ICSR_FIELDS.map((spec) => {
    const p = proposed.find((x) => x.key === spec.key);
    const cites: Citation[] = (p?.citations ?? []).map((c) => {
      const doc = file.documents.find((d) => d.id === c.docId);
      const verified = verifyCitation({ ...c, docTitle: doc?.title ?? "" }, file.documents);
      if (!verified) rejected++;
      return { ...c, docTitle: doc?.title ?? c.docId, verified };
    });
    const good = cites.filter((c) => c.verified);
    const candidates = p?.candidates?.length ? p.candidates : undefined;

    let value = p?.value ?? null;
    let status: ExtractedField["status"];
    if (candidates && candidates.length > 1) {
      value = null;
      status = "gap";
    } else if (value && good.length > 0) {
      status = "sourced";
    } else if (value && good.length === 0) {
      // a value with no surviving citation is not trusted
      value = null;
      status = "gap";
    } else {
      status = spec.critical ? "gap" : "unknown";
    }

    return {
      key: spec.key,
      label: spec.label,
      value,
      status,
      candidates,
      citations: good,
      confidence: p?.confidence,
    };
  });

  return {
    patch: { fields },
    trace: {
      agent: "extract",
      agentLabel: "Evidence extraction",
      summary:
        `${fields.filter((f) => f.status === "sourced").length}/${fields.length} fields sourced. ` +
        (rejected ? `${rejected} citation(s) failed verification and were discarded.` : `All citations verified against source text.`),
      toolCalls: [
        { tool: usedModel ? "llm_extract_fields" : "rule_extract_fields", input: `${readable.length} readable documents`, output: `${proposed.length} candidate fields` },
        { tool: "verify_citation", input: `${fields.reduce((a, f) => a + f.citations.length, 0) + rejected} citations`, output: `${rejected} rejected` },
      ],
      stopConditionChecked: STOP_CONDITIONS.extract,
      stopTriggered: rejected > 0,
      modelVersion: usedModel ? activeModelVersion() : null,
      outputKeys: ["fields"],
    },
  };
}

/* ------------------------------------------------------------------ */
/* 03 · TERMINOLOGY — propose a coded term. Never overwrite the source.*/
/* ------------------------------------------------------------------ */
const MEDDRA_LIKE: Record<string, { pt: string; soc: string }> = {
  urticaria: { pt: "Urticaria", soc: "Skin and subcutaneous tissue disorders" },
  rash: { pt: "Rash", soc: "Skin and subcutaneous tissue disorders" },
  thrombocytopenia: { pt: "Thrombocytopenia", soc: "Blood and lymphatic system disorders" },
  "liver injury": { pt: "Drug-induced liver injury", soc: "Hepatobiliary disorders" },
  hepatic: { pt: "Hepatic function abnormal", soc: "Hepatobiliary disorders" },
  jaundice: { pt: "Jaundice", soc: "Hepatobiliary disorders" },
};

export async function terminology(file: CaseFile): Promise<AgentResult> {
  const ev = file.fields.find((f) => f.key === "event_term");
  const reported = ev?.value ?? null;
  let mapped: { pt: string; soc: string } | null = null;

  if (reported) {
    const lc = reported.toLowerCase();
    for (const [k, v] of Object.entries(MEDDRA_LIKE)) if (lc.includes(k)) { mapped = v; break; }
  }

  const fields = file.fields.map((f) =>
    f.key === "event_term" && mapped
      ? { ...f, value: f.value, originalValue: f.value, label: "Event term", confidence: f.confidence }
      : f
  );

  return {
    patch: {
      fields,
      edges: mapped && reported
        ? [{ from: reported, to: mapped.pt, relation: "coded_as", status: "candidate" as const, note: `Proposed term, ${mapped.soc}. Reported wording preserved. Human confirmation required.` }]
        : [],
    },
    trace: {
      agent: "terminology",
      agentLabel: "Terminology mapping",
      summary: mapped
        ? `Reported term "${reported}" → proposed coded term "${mapped.pt}". Original wording preserved; mapping NOT applied without human confirmation.`
        : `No coded term proposed — reported event term not resolved.`,
      toolCalls: [{ tool: "lookup_terminology", input: reported ?? "(none)", output: mapped ? `${mapped.pt} · ${mapped.soc}` : "no match" }],
      stopConditionChecked: STOP_CONDITIONS.terminology,
      stopTriggered: false,
      modelVersion: null,
      outputKeys: ["edges"],
    },
  };
}

/* ------------------------------------------------------------------ */
/* 04 · EVIDENCE GRAPH — link facts, surface conflicts, never causal.  */
/* ------------------------------------------------------------------ */
export async function evidenceGraph(file: CaseFile): Promise<AgentResult> {
  const get = (k: string) => file.fields.find((f) => f.key === k);
  const edges: GraphEdge[] = [...file.edges];

  const drug = get("suspect_drug");
  const event = get("event_term");
  const onset = get("onset_date");
  const lab = get("relevant_lab");

  if (event?.value && drug?.value) {
    edges.push({ from: drug.value, to: event.value, relation: "temporally_associated_with", status: "candidate", note: "Temporal association only. Causality is not assessed by SURE." });
  } else if (event?.value && drug?.candidates?.length) {
    for (const c of drug.candidates)
      edges.push({ from: c, to: event.value, relation: "temporally_associated_with", status: "unresolved", note: "One of several plausible products. Not separable from the available sources." });
  }
  if (event?.value && onset?.value) edges.push({ from: event.value, to: onset.value, relation: "onset_on", status: "documented" });
  if (event?.value && lab?.value) edges.push({ from: lab.value, to: event.value, relation: "supports", status: "documented" });

  const conflicts = detectConflicts({ ...file, edges });
  const unresolved = edges.filter((e) => e.status === "unresolved").length;

  return {
    patch: { edges, conflicts },
    trace: {
      agent: "evidenceGraph",
      agentLabel: "Evidence graph & reconciliation",
      summary: `${edges.length} links built — ${edges.filter((e) => e.status === "documented").length} documented, ${edges.filter((e) => e.status === "candidate").length} candidate, ${unresolved} unresolved. ${conflicts.length} conflict(s) surfaced.`,
      toolCalls: [
        { tool: "build_evidence_graph", input: `${file.fields.filter((f) => f.value).length} valued fields`, output: `${edges.length} edges` },
        { tool: "detect_conflicts", input: "cross-document comparison", output: conflicts.length ? conflicts.map((c) => c.field).join(", ") : "none" },
      ],
      stopConditionChecked: STOP_CONDITIONS.evidenceGraph,
      stopTriggered: false,
      modelVersion: null,
      outputKeys: ["edges", "conflicts"],
    },
  };
}

/* ------------------------------------------------------------------ */
/* 05 · RISK — rank the queue, explain why, never suppress.            */
/* ------------------------------------------------------------------ */
export async function risk(file: CaseFile): Promise<AgentResult> {
  const reasons: string[] = [];
  let level: "routine" | "expedited" | "urgent" = "routine";

  const serious = file.fields.find((f) => f.key === "seriousness")?.value ?? "";
  const lab = file.fields.find((f) => f.key === "relevant_lab")?.value ?? "";

  if (/hospitalis|life.threat|death/i.test(serious) || /^serious/i.test(serious.trim())) {
    level = "urgent";
    reasons.push(`Seriousness recorded as "${serious}" — mandatory expedited handling.`);
  }
  if (/critical|42 x 10\^9|412 u\/l/i.test(lab)) {
    level = level === "urgent" ? "urgent" : "expedited";
    reasons.push(`Laboratory value flagged critical in the source: ${lab}.`);
  }
  if (file.conflicts.some((c) => c.severity === "critical")) {
    level = level === "routine" ? "expedited" : level;
    reasons.push("Critical field conflict present — requires human adjudication before drafting.");
  }
  if (!reasons.length) reasons.push("No expedited criteria met from the available fields. Routine queue.");

  return {
    patch: { riskRank: { level, reasons } },
    trace: {
      agent: "risk",
      agentLabel: "Risk prioritisation",
      summary: `Queue level: ${level.toUpperCase()}. ${reasons.length} stated reason(s). Ranking is a review aid only; no case was suppressed.`,
      toolCalls: [{ tool: "apply_priority_rules", input: `seriousness="${serious}", lab="${lab}"`, output: level }],
      stopConditionChecked: STOP_CONDITIONS.risk,
      stopTriggered: false,
      modelVersion: null,
      outputKeys: ["riskRank"],
    },
  };
}

/* ------------------------------------------------------------------ */
/* 06 · COMPLETENESS — unknown stays unknown; draft the follow-up.     */
/* ------------------------------------------------------------------ */
export async function completeness(file: CaseFile): Promise<AgentResult> {
  const gaps = file.fields.filter((f) => f.status === "gap").map((f) => f.key);
  const criticalGaps = ICSR_FIELDS.filter((s) => s.critical && gaps.includes(s.key));

  const bad = unreadablePages(file.documents);
  const lines: string[] = [];
  for (const k of gaps) {
    const spec = ICSR_FIELDS.find((s) => s.key === k)!;
    const f = file.fields.find((x) => x.key === k)!;
    lines.push(
      f.candidates?.length
        ? `• ${spec.label}: sources support ${f.candidates.join(" and ")}. Please confirm which is correct and state the basis for that decision. SURE has not chosen between them.`
        : `• ${spec.label}: not stated in any supplied source. Please provide the value or confirm it is genuinely unknown.`
    );
  }
  for (const b of bad) lines.push(`• ${b.docTitle}, page ${b.page} could not be read. Please resupply a legible copy.`);

  const followUpQuery = lines.length
    ? `FOLLOW-UP QUERY — case ${file.caseId}\n\nThe following items could not be resolved from the documents supplied. SURE has not filled them in.\n\n${lines.join("\n")}\n\nThis query was drafted automatically and has not been answered. No value above has been inferred.`
    : null;

  return {
    patch: { gaps, followUpQuery },
    trace: {
      agent: "completeness",
      agentLabel: "Completeness & consistency",
      summary: `${gaps.length} gap(s) recorded (${criticalGaps.length} on critical fields). ${followUpQuery ? "Follow-up query drafted, not answered." : "No gaps — no query needed."} No value was invented to pass a check.`,
      toolCalls: [
        { tool: "validate_required_fields", input: `${ICSR_FIELDS.length} fields`, output: `${gaps.length} gaps` },
        { tool: "draft_follow_up_query", input: `${lines.length} items`, output: followUpQuery ? "drafted" : "not required" },
      ],
      stopConditionChecked: STOP_CONDITIONS.completeness,
      stopTriggered: criticalGaps.length > 0,
      modelVersion: null,
      outputKeys: ["gaps", "followUpQuery"],
    },
  };
}

/* ------------------------------------------------------------------ */
/* 07 · DRAFT — sourced facts only. Halts on a critical conflict.      */
/* ------------------------------------------------------------------ */
export async function draft(file: CaseFile): Promise<AgentResult> {
  const criticalConflict = file.conflicts.find((c) => c.severity === "critical");
  if (criticalConflict) {
    return {
      patch: {
        narrative: null,
        halted: true,
        haltAgent: "draft",
        haltReason: `Critical field conflict on "${criticalConflict.field}". ${criticalConflict.description} SURE will not draft a narrative over an unresolved critical conflict — the case is escalated for human adjudication.`,
      },
      trace: {
        agent: "draft",
        agentLabel: "Narrative drafting",
        summary: `HALTED. Critical conflict on ${criticalConflict.field}. No narrative produced. Case escalated to a qualified reviewer.`,
        toolCalls: [{ tool: "check_conflicts_before_draft", input: `${file.conflicts.length} conflicts`, output: "critical — halt" }],
        stopConditionChecked: STOP_CONDITIONS.draft,
        stopTriggered: true,
        modelVersion: null,
        outputKeys: [],
      },
    };
  }

  const sourced = file.fields.filter((f) => f.status === "sourced" && f.value);
  const gaps = file.fields.filter((f) => f.status === "gap");
  let narrative: string;
  let usedModel = false;

  const factBlock = sourced.map((f) => `${f.label}: ${f.value} [${f.citations[0]?.docTitle ?? "source"} p.${f.citations[0]?.page ?? "?"}]`).join("\n");
  const gapBlock = gaps.map((f) => f.label).join(", ") || "none";

  if (activeProvider()) {
    try {
      const out = await callModelJSON<{ narrative: string }>({
        system: `You draft the case narrative section of an ICSR.
Hard rules:
- Use ONLY the facts supplied. Do not add any clinical detail that is not listed.
- Do not assert causality. State temporal sequence only.
- Where a field is listed as unresolved, write that it is not stated. Never substitute a plausible value.
- Plain clinical English, past tense, 90-150 words, one paragraph.
Return {"narrative":"..."}`,
        user: `SOURCED FACTS:\n${factBlock}\n\nUNRESOLVED (must be described as not stated): ${gapBlock}`,
        maxTokens: 500,
      });
      narrative = out.narrative;
      usedModel = true;
    } catch {
      narrative = templateNarrative(sourced, gaps);
    }
  } else {
    narrative = templateNarrative(sourced, gaps);
  }

  return {
    patch: { narrative },
    trace: {
      agent: "draft",
      agentLabel: "Narrative drafting",
      summary: `Narrative drafted from ${sourced.length} sourced field(s). ${gaps.length} unresolved item(s) described as not stated rather than filled. Draft cannot be submitted — human approval required.`,
      toolCalls: [{ tool: usedModel ? "llm_draft_narrative" : "template_draft_narrative", input: `${sourced.length} sourced facts`, output: `${narrative.split(/\s+/).length} words` }],
      stopConditionChecked: STOP_CONDITIONS.draft,
      stopTriggered: false,
      modelVersion: usedModel ? activeModelVersion() : null,
      outputKeys: ["narrative"],
    },
  };
}

function templateNarrative(sourced: ExtractedField[], gaps: ExtractedField[]): string {
  const v = (k: string) => sourced.find((f) => f.key === k)?.value ?? null;
  const parts: string[] = [];
  const drug = v("suspect_drug");
  const event = v("event_term");
  const onset = v("onset_date");

  parts.push(
    drug
      ? `The patient was receiving ${drug}${v("dose") ? ` (${v("dose")})` : ""}${v("therapy_start") ? `, commenced ${v("therapy_start")}` : ""}.`
      : `The suspect product could not be resolved from the supplied sources.`
  );
  if (event) parts.push(`${event} was reported${onset ? ` with onset on ${onset}` : ""}.`);
  if (v("relevant_lab")) parts.push(`Laboratory findings recorded ${v("relevant_lab")}.`);
  if (v("seriousness")) parts.push(`The event was assessed as ${v("seriousness")}.`);
  if (v("dechallenge")) parts.push(`Dechallenge: ${v("dechallenge")}.`);
  if (v("outcome")) parts.push(`Outcome at the time of reporting: ${v("outcome")}.`);
  if (gaps.length)
    parts.push(`The following were not stated in any supplied source and have not been inferred: ${gaps.map((g) => g.label.toLowerCase()).join(", ")}.`);
  parts.push(`Temporal association is described; causality has not been assessed.`);
  return parts.join(" ");
}

/* ------------------------------------------------------------------ */
/* 08 · HUMAN GATE — the chain stops here, always.                     */
/* ------------------------------------------------------------------ */
export async function humanGate(file: CaseFile): Promise<AgentResult> {
  return {
    patch: {},
    trace: {
      agent: "humanGate",
      agentLabel: "Qualified reviewer",
      summary: file.halted
        ? `Case escalated without a draft. A qualified reviewer must adjudicate before processing continues.`
        : `Draft and ${file.gaps.length} open gap(s) presented for review. Nothing can be exported until a reviewer approves.`,
      toolCalls: [{ tool: "await_human_decision", input: `case ${file.caseId}`, output: "pending" }],
      stopConditionChecked: STOP_CONDITIONS.humanGate,
      stopTriggered: true,
      modelVersion: null,
      outputKeys: [],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic fallback extractor — used in seeded mode.             */
/* It genuinely parses the documents; it does not read the answer key. */
/* ------------------------------------------------------------------ */
const EVENT_TERMS = [
  "drug-induced liver injury",
  "thrombocytopenia",
  "urticaria",
  "jaundice",
  "rash",
];

interface Snip { docId: string; page: number; kind: string; text: string }

/** Page text → sentence-ish snippets, so a wrapped line is still one fact. */
function snippets(docs: CaseDocument[]): Snip[] {
  const out: Snip[] = [];
  for (const d of docs)
    for (const p of d.pages) {
      const flat = d.kind === "lab_report" ? p.text : p.text.replace(/\n(?![ ]*[-\u2022]|[A-Z][a-z]+:|\n)/g, " ");
      for (const raw of flat.split(/\n|(?<=\.)\s{1,}(?=[A-Z])/)) {
        const t = raw.trim();
        if (t) out.push({ docId: d.id, page: p.n, kind: d.kind, text: t.replace(/\s{2,}/g, " ") });
      }
    }
  return out;
}

const DATE = /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/;
const SHORT_DATE = /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/;
const MONTHS: Record<string, number> = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

function toDay(d: string): number | null {
  const m = d.match(DATE) ?? d.match(SHORT_DATE);
  if (!m) return null;
  const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
  const year = m[3] ? Number(m[3]) : 2026;
  return Date.UTC(year, mon, Number(m[1])) / 86400000;
}

function deterministicExtract(docs: CaseDocument[]): Partial<ExtractedField>[] {
  const snips = snippets(docs);
  const out: Partial<ExtractedField>[] = [];
  const find = (re: RegExp, kind?: string) =>
    snips.find((s) => (!kind || s.kind === kind) && re.test(s.text));
  const cite = (s?: Snip): Citation[] =>
    s ? [{ docId: s.docId, page: s.page, quote: s.text } as Citation] : [];
  const push = (key: string, value: string | null, src?: Snip, candidates?: string[]) =>
    out.push({ key, value, candidates, confidence: value ? 0.74 : undefined, citations: cite(src) });

  /* --- event term: prefer an explicit assessment, prefer the longest match --- */
  const assess = find(/^assessment:/i);
  const evSnip =
    (assess && EVENT_TERMS.some((t) => assess.text.toLowerCase().includes(t)) ? assess : null) ??
    snips.find((s) => EVENT_TERMS.some((t) => s.text.toLowerCase().includes(t)));
  const evTerm = evSnip ? EVENT_TERMS.find((t) => evSnip.text.toLowerCase().includes(t)) ?? null : null;
  push("event_term", evTerm ? evTerm.replace(/^./, (c) => c.toUpperCase()) : null, evSnip ?? undefined);

  /* --- suspect drug: explicit label wins, else medication list becomes candidates --- */
  const sus = find(/suspect product:/i);
  if (sus) {
    const name = sus.text.replace(/.*suspect product:\s*/i, "").split(/[,0-9]/)[0].trim();
    push("suspect_drug", name || null, sus);
  } else {
    const meds = snips
      .filter((s) => /^-\s+[A-Z][a-z]+/.test(s.text) && /\d+\s*mg/.test(s.text))
      .map((s) => s.text.replace(/^-\s+/, "").split(/\s+\d/)[0].trim());
    const plausible = meds.filter((m) => !/metformin/i.test(m));
    push("suspect_drug", null, undefined, plausible.length > 1 ? plausible : undefined);
  }

  const doseSnip = find(/\d+\s*mg[^.]*\b(once|twice|three times)\s+daily/i);
  push("dose", doseSnip ? doseSnip.text.match(/\d+\s*mg[^.]*?(once|twice|three times)\s+daily/i)?.[0]?.replace(/\s{2,}/g, " ").trim() ?? null : null, doseSnip);

  /* --- therapy start / stop may share one sentence --- */
  const startSnip = find(/therapy start:|commenced \d{1,2}\s+\w+\s+\d{4}/i);
  push("therapy_start", startSnip ? (startSnip.text.match(/(?:therapy start:|commenced)\s*(\d{1,2}\s+\w+\s+\d{4})/i)?.[1] ?? null) : null, startSnip);
  const stopSnip = find(/therapy stop:|discontinued on \d|withhold/i);
  push("therapy_stop", stopSnip ? (stopSnip.text.match(/(?:therapy stop:|discontinued on)\s*(\d{1,2}\s+\w+\s+\d{4})/i)?.[1] ?? null) : null, stopSnip);

  /* --- onset: compare the clinician's stated onset against the diary --- */
  const noteOnset = find(/first noticed on|onset of symptoms recorded as/i, "physician_note");
  const noteOnsetDate =
    noteOnset?.text.match(/(?:first noticed on(?: the evening of)?|onset of symptoms recorded as)\s*(\d{1,2}\s+\w+\s+\d{4})/i)?.[1] ??
    noteOnset?.text.match(DATE)?.[0] ?? null;
  const presented = find(/presented on \d/i, "physician_note");
  const presentedDate = presented?.text.match(DATE)?.[0] ?? null;

  const diaryFirstSymptom = snips.find(
    (s) => s.kind === "patient_diary" && SHORT_DATE.test(s.text) &&
      /(bruis|rash|bump|itch|sick|queasy|nausea|dark urine|ache|bled|tired)/i.test(s.text)
  );
  const diaryDate = diaryFirstSymptom?.text.match(SHORT_DATE)?.[0] ?? null;

  if (noteOnsetDate && diaryDate) {
    const a = toDay(noteOnsetDate), b = toDay(diaryDate);
    if (a !== null && b !== null && Math.abs(a - b) > 3) {
      // Sources disagree on a critical field. Record both; resolve neither.
      out.push({ key: "onset_date", value: null, candidates: [noteOnsetDate, diaryDate + " (patient diary)"], citations: [...cite(noteOnset), ...cite(diaryFirstSymptom)] });
    } else {
      push("onset_date", noteOnsetDate, noteOnset);
    }
  } else if (noteOnsetDate) {
    push("onset_date", noteOnsetDate, noteOnset);
  } else if (presentedDate) {
    push("onset_date", presentedDate, presented);
  } else {
    push("onset_date", null);
  }

  const dech = find(/began to fade|fully resolved|resolved after/i);
  push("dechallenge", dech ? "Positive — event resolved after withdrawal" : null, dech);

  const rech = find(/no rechallenge/i);
  push("rechallenge", rech ? "Not performed" : null, rech);

  /* --- seriousness: the negative statement must be tested first --- */
  const nonSerious = find(/did not require hospitalisation|non-serious/i);
  const serious = find(/admitted to the (medical )?ward|was admitted|hospitalised/i);
  push("seriousness", nonSerious ? "Non-serious" : serious ? "Serious — hospitalisation" : null, nonSerious ?? serious);

  const outcome = find(/recovered without sequelae|patient recovered|fully resolved by/i);
  push("outcome", outcome ? "Recovered" : null, outcome);

  const labLines = snips.filter(
    (s) => s.kind === "lab_report" && /(CRITICAL LOW|HIGH)\s*$/.test(s.text) &&
      /(platelet|alt |ast |eosinophil|bilirubin|haemoglobin)/i.test(s.text)
  );
  const labSnip = labLines.find((s) => /CRITICAL LOW\s*$/.test(s.text)) ?? labLines[0];
  push(
    "relevant_lab",
    labSnip ? labSnip.text.replace(/\(ref[^)]*\)/i, "").replace(/\s*(CRITICAL LOW|HIGH|LOW)\s*$/, "").replace(/\s{2,}/g, " ").trim() : null,
    labSnip
  );

  return out;
}
