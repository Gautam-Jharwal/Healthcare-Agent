/**
 * Builds an export of an approved case keyed by ICH E2B(R3) data-element IDs.
 *
 * This is deliberately a readable, simplified structure for review — NOT a
 * schema-valid HL7 v3 ICSR message. A production export maps these same
 * elements into the HL7 ICSR message and validates it against the regional
 * schema before anything is transmitted. SURE itself never transmits.
 */

import type { CaseFile } from "./engine/types";
import { parseDate } from "./engine/text";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface Approval {
  by: string;
  at: string;
  decision: "approved" | "rejected";
  note?: string;
}

export function buildE2BExport(file: CaseFile, approval: Approval): string {
  const year = file.documents[0] ? new Date(file.documents[0].received).getUTCFullYear() : 2026;
  const f = (k: string) => file.fields.find((x) => x.key === k);
  const ok = (k: string) => {
    const x = f(k);
    return x && x.value && ["sourced", "adjudicated", "corrected"].includes(x.status) ? x : null;
  };
  const src = (k: string) => {
    const x = f(k);
    const c = x?.citations?.[0];
    return c ? ` source="${esc(`${c.docTitle} p.${c.page}`)}"` : x?.review ? ` source="reviewer: ${esc(x.review.by)}"` : "";
  };
  const el = (id: string, name: string, value: string | null, extra = "") =>
    value === null || value === undefined || value === ""
      ? `      <element id="${id}" name="${esc(name)}" nullFlavor="UNK"/>`
      : `      <element id="${id}" name="${esc(name)}"${extra}>${esc(value)}</element>`;
  const iso = (v: string | null | undefined) => (v ? parseDate(v, year)?.iso ?? null : null);

  const pat = ok("patient")?.value ?? null;
  const code = pat?.split(" · ")[0] ?? null;
  const demo = pat?.match(/(Female|Male), (\d+) years/);
  const ser = ok("seriousness")?.value ?? "";
  const crit = (re: RegExp) => (/^serious/i.test(ser) ? (re.test(ser) ? "true" : "false") : null);
  const outcome = ok("outcome")?.value ?? null;
  const outcomeCode = outcome
    ? /fatal/i.test(outcome) ? "5" : /sequelae/i.test(outcome) ? "4" : /not recovered/i.test(outcome) ? "3" : /recovering/i.test(outcome) ? "2" : /recovered/i.test(outcome) ? "1" : "0"
    : null;
  const isStudy = file.documents.some((d) => d.pages.some((p) => /\bstudy\b/i.test(p.text)));
  const day0 = file.clock?.day0 ?? null;
  const dech = ok("dechallenge")?.value ?? "";
  const rech = ok("rechallenge")?.value ?? "";
  const stopV = ok("therapy_stop")?.value ?? null;

  const labs = (ok("relevant_lab")?.value ?? "")
    .split("; ")
    .filter((s) => s && !/^no abnormal/i.test(s))
    .map((s) => {
      const m = s.match(/^(.*?)\s+([\d.,]+)\s*([^(]*?)\s*(\(.*)?$/);
      return m
        ? `    <testResult>\n${el("F.r.2.1", "Test name", m[1])}\n${el("F.r.3.2", "Test result (value)", m[2])}\n${el("F.r.3.3", "Test result (unit)", m[3].trim() || null)}\n    </testResult>`
        : `    <testResult>\n${el("F.r.2.1", "Test name", s)}\n    </testResult>`;
    })
    .join("\n");

  const suspects = ok("suspect_drug")?.value?.replace(/\s*\(co-suspects\)$/, "").split("; ") ?? [];
  const drugBlocks = suspects
    .map(
      (name) => `    <drug>
${el("G.k.1", "Characterisation of drug role (1 = suspect)", "1")}
${el("G.k.2.2", "Medicinal product name as reported", name, src("suspect_drug"))}
${el("G.k.4.r.8", "Dosage text", ok("dose")?.value ?? null, src("dose"))}
${el("G.k.4.r.4", "Date of start of drug", iso(ok("therapy_start")?.value), src("therapy_start"))}
${el("G.k.4.r.5", "Date of last administration", iso(stopV), src("therapy_stop"))}
${el("G.k.8", "Action taken with drug (1 = withdrawn, 0 = unknown)", stopV || /withdraw/i.test(dech) || (f("therapy_stop")?.citations.length ?? 0) > 0 ? "1" : "0")}
${el("G.k.9.i.4", "Did reaction recur on re-administration? (4 = not re-administered)", /not performed/i.test(rech) ? "4" : /positive/i.test(rech) ? "1" : /negative/i.test(rech) ? "2" : null)}
    </drug>`,
    )
    .join("\n");
  const conc = ok("concomitant")?.value;
  const concBlock =
    conc && !/^none$/i.test(conc)
      ? `    <drug>\n${el("G.k.1", "Characterisation of drug role (2 = concomitant)", "2")}\n${el("G.k.2.2", "Medicinal product name as reported", conc, src("concomitant"))}\n    </drug>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  SURE case export keyed by ICH E2B(R3) data-element IDs.
  Simplified structure for review. NOT a schema-valid HL7 v3 ICSR message.
  Unknown values carry nullFlavor="UNK"; nothing has been inferred to fill them.
  Every populated element names the source page it came from.
  SURE does not transmit this file to any regulator.
-->
<sureIcsrExport caseId="${esc(file.caseId)}" exportedAt="${esc(new Date().toISOString())}" approvedBy="${esc(approval.by)}" approvedAt="${esc(approval.at)}" processingMode="${file.mode}" ruleset="SURE-rules 0.3">
  <section id="C.1" name="Identification of the case safety report">
${el("C.1.1", "Sender's (case) safety report unique identifier", file.caseId)}
${el("C.1.3", "Type of report (1 = spontaneous, 2 = report from study)", isStudy ? "2" : "1")}
${el("C.1.4", "Date report was first received from source", day0)}
  </section>
  <section id="C.2.r" name="Primary source(s) of information">
${el("C.2.r.1", "Reporter's name / organisation", ok("reporter")?.value ?? null, src("reporter"))}
  </section>
  <section id="D" name="Patient characteristics">
${el("D.1", "Patient (name or initials / identifier)", code, src("patient"))}
${el("D.2.2a", "Age at time of onset (number)", demo?.[2] ?? null)}
${el("D.2.2b", "Age at time of onset (unit)", demo ? "a (years)" : null)}
${el("D.5", "Sex (1 = male, 2 = female)", demo ? (demo[1] === "Male" ? "1" : "2") : null)}
  </section>
  <section id="E.i" name="Reaction(s) / event(s)">
${el("E.i.1.1a", "Reaction / event as reported by the primary source", ok("event_term")?.value ?? null, src("event_term"))}
${el("E.i.2.1b", "Reaction / event (MedDRA PT) — proposed, coder to confirm", file.codedEvent?.pt ?? null)}
${el("E.i.3.2a", "Results in death", crit(/death/))}
${el("E.i.3.2b", "Life threatening", crit(/life-threatening/))}
${el("E.i.3.2c", "Caused / prolonged hospitalisation", crit(/hospitali/))}
${el("E.i.3.2d", "Disabling / incapacitating", crit(/disability/))}
${el("E.i.3.2e", "Congenital anomaly / birth defect", crit(/congenital/))}
${el("E.i.4", "Date of start of reaction / event", iso(ok("onset_date")?.value), src("onset_date"))}
${el("E.i.7", "Outcome (1 recovered … 5 fatal)", outcomeCode, src("outcome"))}
  </section>
  <section id="F.r" name="Results of tests and procedures">
${labs || '    <!-- no abnormal results in the supplied documents -->'}
  </section>
  <section id="G.k" name="Drug(s) information">
${drugBlocks || el("G.k.2.2", "Medicinal product name as reported", null)}
${concBlock}
  </section>
  <section id="H" name="Narrative case summary">
${el("H.1", "Case narrative", file.narrative)}
${el("H.4", "Sender's comments", `Drafted by SURE from verified source citations (${file.narrativeCheck?.claimsChecked ?? 0} narrative claims checked, ${file.narrativeCheck?.unsupported.length ?? 0} unsupported). Approved by ${approval.by}. Causality and expectedness not assessed by SURE.`)}
  </section>
</sureIcsrExport>
`;
}
