/**
 * Synthetic ICSR case bundles for the SURE MVP.
 *
 * EVERY CASE HERE IS FABRICATED FOR DEMONSTRATION.
 * No real patient data is present, and none must ever be added to this file.
 * Patient identifiers are invented; drug-event pairs are chosen because they
 * are documented in the literature, so the demo stays medically plausible.
 */

export type DocKind = "physician_note" | "patient_diary" | "lab_report" | "ae_form";

export interface CasePage {
  n: number;
  text: string;
  /** true when the page is deliberately degraded, to exercise the stop condition */
  unreadable?: boolean;
}

export interface CaseDocument {
  id: string;
  kind: DocKind;
  title: string;
  received: string;
  pages: CasePage[];
}

export interface ReferenceAnswer {
  /** Hand-written ground truth, used by eval/run_eval.py. */
  fields: Record<string, string | null>;
  expectedGaps: string[];
  expectedStop: string | null;
}

export interface CaseBundle {
  id: string;
  label: string;
  blurb: string;
  demoRole: "clean" | "gaps" | "stop";
  documents: CaseDocument[];
  reference: ReferenceAnswer;
}

export const CASES: CaseBundle[] = [
  /* ------------------------------------------------------------------ *
   * CASE A — complete bundle. Everything resolves; nothing escalates.
   * ------------------------------------------------------------------ */
  {
    id: "IN-2026-0392",
    label: "IN-2026-0392 · Urticaria",
    blurb: "Complete bundle. Positive dechallenge, outcome recorded. Demonstrates the happy path end to end.",
    demoRole: "clean",
    documents: [
      {
        id: "doc-0392-1",
        kind: "physician_note",
        title: "Investigator note — Site 02",
        received: "2026-04-02T09:14:00Z",
        pages: [
          {
            n: 1,
            text: `INVESTIGATOR NOTE — Site 02 — Study SYN-114
Patient code: SYN-114-0087. Female, 34 years. Weight 61 kg.

Indication: acute bacterial sinusitis.
Suspect product: Amoxicillin 500 mg oral, three times daily.
Therapy start: 22 March 2026. Therapy stop: 27 March 2026.

Narrative: Patient contacted the site on 27 March 2026 reporting an itchy
raised rash over the trunk and both forearms, first noticed on the evening of
26 March 2026. No facial swelling, no breathing difficulty, no hypotension.
Afebrile. No new foods, detergents or cosmetics reported.

Amoxicillin was discontinued on 27 March 2026. Oral cetirizine 10 mg daily was
started symptomatically. The rash began to fade within 48 hours and had fully
resolved by 31 March 2026, confirmed at the follow-up visit on 1 April 2026.

Assessment: urticaria, considered by the investigator to be possibly related to
amoxicillin. Event did not require hospitalisation. Patient recovered without
sequelae. No rechallenge attempted.

Concomitant medication: none.
Relevant medical history: none reported. No known drug allergies on file.`,
          },
        ],
      },
      {
        id: "doc-0392-2",
        kind: "patient_diary",
        title: "Patient diary extract",
        received: "2026-04-02T09:14:00Z",
        pages: [
          {
            n: 1,
            text: `MY HEALTH DIARY — SYN-114-0087

26 Mar — Took the antibiotic as usual. In the evening noticed red itchy bumps
on my stomach and arms. Quite itchy. No fever.
27 Mar — Bumps are worse and have spread a bit. Called the study nurse. Told to
stop the antibiotic and start an antihistamine.
28 Mar — Itching much better already. Bumps fading.
29 Mar — Only faint marks left.
31 Mar — Skin looks normal again. Feeling fine.`,
          },
        ],
      },
      {
        id: "doc-0392-3",
        kind: "lab_report",
        title: "Laboratory report — 28 Mar 2026",
        received: "2026-04-02T09:20:00Z",
        pages: [
          {
            n: 1,
            text: `LABORATORY REPORT
Patient code: SYN-114-0087   Sample type: Serum
Date of collection: 28 March 2026   Date of report: 29 March 2026

Complete Blood Count
  Haemoglobin        12.8 g/dL      (ref 12.0 - 16.0)
  Total WBC count    8,100 /uL      (ref 4,000 - 11,000)
  Eosinophils        6.2 %          (ref 1 - 4)        HIGH
  Platelet count     268,000 /uL    (ref 150,000 - 450,000)

Liver Function Test
  ALT (SGPT)         22 U/L         (ref 0 - 40)
  AST (SGOT)         19 U/L         (ref 0 - 40)
  Total bilirubin    0.7 mg/dL      (ref 0.2 - 1.2)

Comment: mild eosinophilia. No other abnormality detected.`,
          },
        ],
      },
    ],
    reference: {
      fields: {
        event_term: "Urticaria",
        onset_date: "2026-03-26",
        suspect_drug: "Amoxicillin",
        dose: "500 mg three times daily, oral",
        therapy_start: "2026-03-22",
        therapy_stop: "2026-03-27",
        dechallenge: "Positive — event resolved after withdrawal",
        rechallenge: "Not performed",
        seriousness: "Non-serious",
        outcome: "Recovered",
        relevant_lab: "Eosinophils 6.2% (high)",
      },
      expectedGaps: [],
      expectedStop: null,
    },
  },

  /* ------------------------------------------------------------------ *
   * CASE B — the bundle shown on Slide 2. Two candidate suspect drugs,
   * dechallenge never documented, outcome still unknown at report time.
   * ------------------------------------------------------------------ */
  {
    id: "IN-2026-0417",
    label: "IN-2026-0417 · Thrombocytopenia",
    blurb: "Two plausible suspect drugs, no dechallenge documented, outcome unknown. Demonstrates the gap ledger and the follow-up query.",
    demoRole: "gaps",
    documents: [
      {
        id: "doc-0417-1",
        kind: "physician_note",
        title: "Investigator note — Site 04",
        received: "2026-03-18T11:02:00Z",
        pages: [
          {
            n: 1,
            text: `INVESTIGATOR NOTE — Site 04 — Study SYN-221
Patient code: SYN-221-0143. Male, 58 years. Weight 74 kg.

Reason for admission: patient presented on 14 March 2026 with extensive
bruising over both forearms and the left thigh, and bleeding from the gums on
brushing. No melaena, no haematuria. No recent trauma reported.

Current medication at presentation:
  - Linezolid 600 mg twice daily, oral, commenced 28 February 2026
    (indication: diabetic foot infection)
  - Sodium valproate 500 mg twice daily, oral, commenced 02 March 2026
    (indication: post-stroke seizure prophylaxis)
  - Metformin 1000 mg twice daily, oral, long-term

Patient was admitted to the medical ward on 14 March 2026 for observation and
investigation of thrombocytopenia.

Assessment: drug-induced thrombocytopenia suspected. Both linezolid and sodium
valproate are plausible causative agents and the temporal relationship does not
clearly separate them. Haematology review requested.

Note: patient transferred to the care of the haematology team on 15 March 2026.
Further management and medication decisions were not recorded in this chart.`,
          },
        ],
      },
      {
        id: "doc-0417-2",
        kind: "patient_diary",
        title: "Patient diary extract",
        received: "2026-03-18T11:02:00Z",
        pages: [
          {
            n: 1,
            text: `MY HEALTH DIARY — SYN-221-0143

10 Mar — Felt tired. Noticed a small bruise on my left arm, did not think much
of it.
12 Mar — More bruises on both arms. I do not remember knocking into anything.
13 Mar — Gums bled a bit when brushing my teeth. Bruise on my thigh now too.
14 Mar — Went to hospital in the morning. Doctors took blood. They said my
platelet count is low and kept me in.
15 Mar — Moved to a different ward. New team of doctors.`,
          },
        ],
      },
      {
        id: "doc-0417-3",
        kind: "lab_report",
        title: "Laboratory report — 14 Mar 2026",
        received: "2026-03-18T11:08:00Z",
        pages: [
          {
            n: 1,
            text: `LABORATORY REPORT
Patient code: SYN-221-0143   Sample type: Whole blood (EDTA)
Date of collection: 14 March 2026   Date of report: 14 March 2026

Complete Blood Count
  Haemoglobin        11.9 g/dL        (ref 13.0 - 17.0)   LOW
  Total WBC count    7,400 /uL        (ref 4,000 - 11,000)
  Platelet count     42 x 10^9/L      (ref 150 - 450 x 10^9/L)   CRITICAL LOW

Peripheral smear: thrombocytopenia confirmed on smear. No schistocytes seen.
No platelet clumping observed.

Renal Function
  Serum creatinine   1.1 mg/dL        (ref 0.6 - 1.2)
  Blood urea nitrogen 16 mg/dL        (ref 7 - 20)

Comment: critical low platelet count telephoned to the ward at 11:20 on
14 March 2026. Repeat count advised in 24 hours. No repeat sample received.`,
          },
        ],
      },
    ],
    reference: {
      fields: {
        event_term: "Thrombocytopenia",
        onset_date: "2026-03-14",
        suspect_drug: null,
        dose: null,
        therapy_start: null,
        therapy_stop: null,
        dechallenge: null,
        rechallenge: "Not performed",
        seriousness: "Serious — hospitalisation",
        outcome: null,
        relevant_lab: "Platelet count 42 x 10^9/L",
      },
      expectedGaps: ["suspect_drug", "dechallenge", "outcome"],
      expectedStop: null,
    },
  },

  /* ------------------------------------------------------------------ *
   * CASE C — the bundle that must NOT produce a draft. Critical field
   * conflict plus an unreadable source page. The chain halts.
   * ------------------------------------------------------------------ */
  {
    id: "IN-2026-0433",
    label: "IN-2026-0433 · Hepatic injury (conflicted)",
    blurb: "Sources disagree on onset date and a lab page is unreadable. Demonstrates the hard stop — SURE refuses to draft.",
    demoRole: "stop",
    documents: [
      {
        id: "doc-0433-1",
        kind: "physician_note",
        title: "Investigator note — Site 07",
        received: "2026-04-11T16:40:00Z",
        pages: [
          {
            n: 1,
            text: `INVESTIGATOR NOTE — Site 07 — Study SYN-308
Patient code: SYN-308-0056. Female, 47 years.

Suspect product: Isoniazid 300 mg once daily, oral, commenced 02 March 2026
(indication: latent tuberculosis treatment).

Narrative: Patient reported nausea, right upper quadrant discomfort and dark
urine. Onset of symptoms recorded as 03 April 2026. Liver function tests were
requested the same day.

Scleral icterus noted on examination. Patient advised to withhold isoniazid
pending results.

Assessment: suspected drug-induced liver injury. Causality not yet assessed.

Concomitant medication: oral contraceptive (long-term), paracetamol as required
for headache — patient reports occasional use, dose and frequency not
quantified.`,
          },
        ],
      },
      {
        id: "doc-0433-2",
        kind: "patient_diary",
        title: "Patient diary extract",
        received: "2026-04-11T16:40:00Z",
        pages: [
          {
            n: 1,
            text: `MY HEALTH DIARY — SYN-308-0056

26 Mar — Felt a bit sick after meals. Thought it was something I ate.
28 Mar — Still queasy. Noticed my urine looked darker than usual.
29 Mar — Ache under the right ribs. Tired.
01 Apr — Same symptoms, no better.
03 Apr — Rang the clinic and described everything. They asked me to come in for
blood tests.`,
          },
        ],
      },
      {
        id: "doc-0433-3",
        kind: "lab_report",
        title: "Laboratory report — 03 Apr 2026",
        received: "2026-04-11T16:46:00Z",
        pages: [
          {
            n: 1,
            text: `LABORATORY REPORT
Patient code: SYN-308-0056   Sample type: Serum
Date of collection: 03 April 2026

Liver Function Test
  ALT (SGPT)         412 U/L        (ref 0 - 40)     HIGH
  AST (SGOT)         388 U/L        (ref 0 - 40)     HIGH
  Total bilirubin    3.9 mg/dL      (ref 0.2 - 1.2)  HIGH

Continued on page 2 — alkaline phosphatase, GGT, INR.`,
          },
          {
            n: 2,
            unreadable: true,
            text: `[PAGE 2 OF 2 — SCAN QUALITY INSUFFICIENT]
??? ?????? ?????????? ???  ##  ???
Alk Phos  ???? U/L   (ref 40 - 129)
GGT       ???? U/L
INR       ?.??
[Optical character recognition confidence below threshold. Source page could
not be read reliably. Values on this page must not be inferred.]`,
          },
        ],
      },
    ],
    reference: {
      fields: {
        event_term: "Drug-induced liver injury",
        onset_date: null,
        suspect_drug: "Isoniazid",
        dose: "300 mg once daily, oral",
        therapy_start: "2026-03-02",
        therapy_stop: null,
        dechallenge: null,
        rechallenge: "Not performed",
        seriousness: null,
        outcome: null,
        relevant_lab: "ALT 412 U/L, AST 388 U/L, bilirubin 3.9 mg/dL",
      },
      expectedGaps: ["onset_date", "therapy_stop", "seriousness", "outcome"],
      expectedStop: "critical_field_conflict",
    },
  },
];

export const ICSR_FIELDS = [
  { key: "event_term", label: "Event term", critical: true },
  { key: "onset_date", label: "Onset date", critical: true },
  { key: "suspect_drug", label: "Suspect drug", critical: true },
  { key: "dose", label: "Dose & route", critical: false },
  { key: "therapy_start", label: "Therapy start", critical: false },
  { key: "therapy_stop", label: "Therapy stop", critical: false },
  { key: "dechallenge", label: "Dechallenge", critical: false },
  { key: "rechallenge", label: "Rechallenge", critical: false },
  { key: "seriousness", label: "Seriousness", critical: true },
  { key: "outcome", label: "Outcome", critical: true },
  { key: "relevant_lab", label: "Relevant lab", critical: false },
] as const;

export function getCase(id: string): CaseBundle | undefined {
  return CASES.find((c) => c.id === id);
}
