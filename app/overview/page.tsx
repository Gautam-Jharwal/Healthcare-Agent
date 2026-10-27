import Link from "next/link";
import Header from "@/components/Header";
import { PipelineReplay } from "@/components/Pipeline";
import { CASES } from "@/lib/cases";
import { runGraphToEnd } from "@/lib/engine/graph";
import { scoreCase, totals, type CaseScore } from "@/lib/engine/score";
import "../site.css";

/** Numbers on this page come from a real run of the agent graph at build time (rules only). */
async function seededResults() {
  const scores: CaseScore[] = [];
  for (const c of CASES.filter((x) => x.reference)) {
    const f = await runGraphToEnd(c, {}, { seeded: true });
    scores.push(scoreCase(c, f)!);
  }
  return { core: totals(scores.filter((s) => s.set === "core")), stress: totals(scores.filter((s) => s.set === "stress")), heldout: totals(scores.filter((s) => s.set === "heldout")) };
}

const STAGES = [
  ["Collect", "Notes, diaries, lab PDFs, forms and email arrive separately"],
  ["Extract", "Dates, products, doses and lab values sit in free text"],
  ["Reconcile", "Sources disagree; duplicates and follow-ups arrive later"],
  ["Interpret", "The suspect product is unclear; confounders are unresolved"],
  ["Code", "Term choice varies by reviewer and dictionary version"],
  ["Assess", "Seriousness needs an expert; queues run first in, first out"],
  ["Draft", "Approved facts are re-typed into E2B(R3) fields and narrative"],
  ["Review", "The reviewer retraces every fact to its source before sign-off"],
];

const CONTROLS: [string, string][] = [
  ["Citations are verified against the page", "A quote must be found on the page it names. Unreadable pages cannot be cited. A value whose citation fails is thrown away, not shown."],
  ["The value must be inside its quote", "A real quote attached to an invented number fails: every number and date in a value has to appear in the quoted text."],
  ["Two independent readers", "A rule-based reader and the model read the same documents. If they disagree on a critical field, a human decides, the way double data entry works in clinical data management."],
  ["One self-correction, then discard", "Citations that fail are sent back to the model once, with the reason. Anything still unverified is dropped."],
  ["Every narrative claim is checked", "Each date, quantity, product and outcome word in the draft must trace to a verified field. Causal language is rejected outright. A failed draft is redrafted once, then replaced by a verified template."],
  ["Instructions inside documents are quarantined", "A line that tries to instruct the AI is withheld from the model and cannot be cited. It is shown struck through to the reviewer."],
  ["Personal identifiers are redacted first", "Phone, Aadhaar-like, PAN-like numbers and email addresses are masked in the interface and removed before any model call."],
  ["Validity and the clock are explicit", "The four ICSR minimum criteria are checked; an invalid case is held, not drafted. The ICH E2A clock is shown with its condition: SURE assesses neither expectedness nor causality."],
  ["Hash-chained audit, gated export", "Every run and reviewer decision is chained by SHA-256. Export is keyed by E2B(R3) element IDs and is only available after a named reviewer approves."],
];

const AGENTS: [string, string, string][] = [
  ["Intake", "Inventories documents, flags unreadable pages, quarantines instruction-like text, finds personal identifiers", "No clinical inference"],
  ["Evidence extraction", "Routes lab tables to a parser and narrative to two readers; verifies, cross-checks and self-corrects", "No value without a verified citation that contains it"],
  ["Reviewer decisions", "Applies adjudications and corrections made by a named reviewer, then re-derives dependent fields", "Never overrides silently; a reason is required"],
  ["Terminology", "Proposes a coded term from a dictionary, or a labelled model suggestion", "Cannot overwrite source wording; a coder confirms"],
  ["Evidence graph", "Links products, events, onset and labs; detects conflicts; searches the case library for follow-ups", "Links are documented, candidate or unresolved, never causal"],
  ["Risk", "Applies named lab rules (severe thrombocytopenia, Hy’s law) and recorded seriousness; computes the reporting clock", "Cannot suppress a case or decide seriousness"],
  ["Completeness", "Checks the four minimum criteria and every field; drafts the follow-up query and reporter letter", "Unknown stays unknown"],
  ["Narrative drafting", "Writes the narrative from verified facts and checks every claim", "Halts on a critical conflict or an invalid case; cannot submit"],
  ["Qualified reviewer", "Adjudicates, corrects, approves or rejects; downloads the export", "Final clinical and regulatory judgement is human"],
];

export default async function Overview() {
  const r = await seededResults();
  return (
    <>
      <Header current="overview" />
      <main className="site">
        <section className="hero">
          <p className="kicker">ABHIKALP 2026, Case 6: Healthcare &amp; Pharmaceuticals. Team Product Avengers.</p>
          <h1>Every fact in a safety report, traceable to the page it came from.</h1>
          <p className="hero-sub">
            SURE is an agentic workflow for pharmacovigilance case processing. Bounded agents assemble an Individual Case Safety Report from physician notes, patient diaries and lab reports, check every citation against the page, and stop, visibly, where the evidence runs out. A qualified reviewer signs every case.
          </p>
          <div className="hero-cta">
            <Link className="btn primary" href="/demo">Open Analysis</Link>
            <Link className="btn" href="/eval">See the evaluation</Link>
          </div>
        </section>

        <figure className="replay">
          <PipelineReplay />
          <figcaption>Replay of case IN-2026-0433. The clinician records onset on 3 April; the patient diary shows symptoms from 26 March. The route agent escalates instead of drafting, and the reviewer adjudicates before the chain resumes.</figcaption>
        </figure>

        <section className="band">
          <div className="band-head">
            <h2>Safety teams spend their time rebuilding the case, not judging it</h2>
            <p>One ICSR arrives as a physician note, a patient diary and a lab PDF with no machine-readable link between them. Five of the eight stages are clerical reconstruction. SURE automates those five and stops at the three that need a qualified person.</p>
          </div>
          <ol className="stages">
            {STAGES.map(([t, d], i) => (
              <li key={t} className={i < 5 ? "auto" : "human"}>
                <span className="n">{i + 1}</span>
                <b>{t}</b>
                <span>{d}</span>
              </li>
            ))}
          </ol>
          <p className="stage-key"><span className="k auto" /> SURE prepares, the reviewer confirms <span className="k human" /> stays with the qualified reviewer</p>
        </section>

        <section className="band">
          <div className="band-head">
            <h2>Three routes, two loops, one gate that cannot be skipped</h2>
            <p>The path through the graph depends on the state of the case.</p>
          </div>
          <div className="routes">
            <div className="route draft"><h3>Draft</h3><p>No critical conflict and all four minimum criteria met. The narrative is written from verified facts only and every claim is checked.</p><Link href="/demo">Try IN-2026-0392</Link></div>
            <div className="route esc"><h3>Escalate</h3><p>Sources disagree on a critical field. The drafting agent never runs. A reviewer adjudicates with a reason, and the chain resumes from extraction with that decision.</p><Link href="/demo">Try IN-2026-0433</Link></div>
            <div className="route hold"><h3>Hold</h3><p>Patient, reporter, event or suspect product is missing, so it is not yet a valid ICSR and the clock has not started. A follow-up query asks for what is missing.</p><Link href="/demo">Try IN-2026-0470</Link></div>
          </div>
          <p className="routes-foot">Loops: extraction self-corrects once when the model’s citations fail verification; drafting redrafts once when the claim verifier rejects a sentence. Both are visible in the trace.</p>
        </section>

        <section className="band">
          <div className="band-head">
            <h2>Controls checked by code, not requested in a prompt</h2>
            <p>A fluent model is not trusted because it sounds right. Its output is trusted only after it survives these checks.</p>
          </div>
          <div className="controls">
            {CONTROLS.map(([t, d]) => (
              <div key={t}><h3>{t}</h3><p>{d}</p></div>
            ))}
          </div>
        </section>

        <section className="band">
          <div className="band-head">
            <h2>Agents, and where each must stop</h2>
            <p>Every boundary below is enforced in code and printed in the live trace on each run.</p>
          </div>
          <div className="table-wrap">
            <table className="agents">
              <thead><tr><th>Agent</th><th>What it does</th><th>Where it must stop</th></tr></thead>
              <tbody>{AGENTS.map(([a, d, s]) => <tr key={a}><td>{a}</td><td>{d}</td><td>{s}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className="band">
          <div className="band-head">
            <h2>Measured, not asserted</h2>
            <p>These numbers are produced by running the agent graph on every reference case when this page is built. The workbench and the evaluation page re-run them live.</p>
          </div>
          <div className="results">
            {[
              ["Demo cases", r.core],
              ["Stress cases", r.stress],
            ].map(([name, t]) => {
              const x = t as typeof r.core;
              return (
                <div key={name as string} className="result">
                  <h3>{name as string} <span>n = {x.cases}, author-tuned</span></h3>
                  <dl>
                    <div><dt>All 14 fields correct</dt><dd>{x.allCorrect}/{x.allTotal}</dd></div>
                    <div><dt>Values without a verified citation</dt><dd>{x.unsupported}/{x.asserted}</dd></div>
                    <div><dt>Gaps found</dt><dd>{x.gapHits}/{x.gapExpected}{x.gapFalse ? ` (+${x.gapFalse} false)` : ""}</dd></div>
                    <div><dt>Correct route</dt><dd>{x.routeOk}/{x.cases}</dd></div>
                    <div><dt>Safety flags raised</dt><dd>{x.flagsHit}/{x.flagsExpected}</dd></div>
                  </dl>
                </div>
              );
            })}
          </div>
          <div className="honest">
            <p><b>What these numbers do not show.</b> Both sets were written by the team that wrote the extractor, so they demonstrate that the controls work, not validated accuracy. The evidence that counts is a held-out set written by someone who has not seen the code{r.heldout.cases ? ` (currently ${r.heldout.allCorrect}/${r.heldout.allTotal} fields on ${r.heldout.cases} cases)` : ", which is the week 6–7 pilot gate"}. The case brief’s 70% drafting-time reduction and 100% accuracy are targets; the <Link href="/study">time study</Link> measures the first, and nothing here claims either.</p>
          </div>
        </section>

        <section className="band">
          <div className="band-head">
            <h2>Pilot plan and what it costs</h2>
            <p>Planning estimates for a 12-week pilot with one Indian MAH or PV service provider, one therapeutic area and governed historical cases. Every figure is an assumption to validate.</p>
          </div>
          <div className="two">
            <div className="table-wrap">
              <table className="agents">
                <thead><tr><th>Weeks</th><th>Stage</th><th>Gate to pass</th></tr></thead>
                <tbody>
                  <tr><td>1–2</td><td>Discovery and baseline time study</td><td>Measured manual minutes per case, by stage</td></tr>
                  <tr><td>3–5</td><td>Configure fields, rules, templates</td><td>Reviewers can trace and correct every field</td></tr>
                  <tr><td>6–7</td><td>Held-out evaluation</td><td>Agreed critical-field accuracy; zero unsupported claims</td></tr>
                  <tr><td>8–10</td><td>Shadow mode beside the live process</td><td>Net time saved without extra correction burden</td></tr>
                  <tr><td>11–12</td><td>Assisted use with approval and rollback</td><td>Proceed, revise or stop on measured results</td></tr>
                </tbody>
              </table>
            </div>
            <div className="table-wrap">
              <table className="agents">
                <thead><tr><th>Cost line</th><th>Estimate</th></tr></thead>
                <tbody>
                  <tr><td>Model calls per case (flash-tier, about 7k input and 2k output tokens across 3–4 calls)</td><td>₹1–7, depending on model and list price</td></tr>
                  <tr><td>Hosting during pilot (private network, database, logging)</td><td>₹20–40k a month</td></tr>
                  <tr><td>Pilot team for 12 weeks (AI engineer, full-stack engineer, part-time PV expert, PM)</td><td>₹12–20 lakh</td></tr>
                  <tr><td>Computer-system validation and security review</td><td>₹3–8 lakh</td></tr>
                  <tr><td><b>Total pilot</b></td><td><b>about ₹16–30 lakh; compute is under 1%</b></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="band">
          <div className="band-head">
            <h2>What SURE does not do yet</h2>
            <p>Stated plainly, because a reviewer will ask.</p>
          </div>
          <ul className="limits">
            <li>Read scanned pages. Text PDFs are read in the browser; OCR is a pilot integration.</li>
            <li>Code against the licensed MedDRA dictionary. The demo uses a small illustrative term list and labels it as such.</li>
            <li>Produce a schema-valid HL7 E2B(R3) message or transmit anything. The export is keyed by E2B element IDs for review.</li>
            <li>Read Indian languages beyond a small Hinglish lexicon in rules mode. The model reader handles more, and always cites the original wording.</li>
            <li>Decide causality, expectedness or seriousness. It shows the evidence and the clock; a qualified person decides.</li>
            <li>Integrate with a safety database. Phase 2 of the roadmap, after the pilot gates are passed.</li>
            <li>Keep data inside your network. In live mode the demo sends redacted synthetic text to a public model API; production would use a private, region-pinned deployment under a data-processing agreement.</li>
            <li>Persist the audit trail. The demo keeps the hash chain in the browser session and lets you download it; production writes it to an append-only store.</li>
          </ul>
        </section>

        <footer className="foot">
          <p><b>SURE: Safety Understanding, Risk &amp; Evidence.</b> Built for ABHIKALP 2026, Case 6: Healthcare &amp; Pharmaceuticals, by Team Product Avengers: Vaishnavi Tyagi, Gautam Jharwal, Sanhita Mahtre and Tanmay Pol.</p>
          <p>All case data is synthetic and fabricated for demonstration. No real patient data is used. Not for clinical or regulatory use. Built with Next.js and TypeScript, one configurable model provider (Gemini, OpenAI or Anthropic), pdf.js and a Python evaluation harness.</p>
        </footer>
      </main>
    </>
  );
}
