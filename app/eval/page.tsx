"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { ICSR_FIELDS } from "@/lib/cases";
import type { CaseScore, Totals } from "@/lib/engine/score";

type EvalBody = { at: string; provider: string | null; live?: boolean; ms: number; scores: CaseScore[]; bySet: Record<string, Totals>; totals: Totals; cached?: boolean; error?: string };

const SHORT: Record<string, string> = {
  patient: "Patient", reporter: "Reporter", event_term: "Event", suspect_drug: "Suspect", onset_date: "Onset", seriousness: "Serious", outcome: "Outcome",
  dose: "Dose", therapy_start: "Start", therapy_stop: "Stop", dechallenge: "Dechal.", rechallenge: "Rechal.", relevant_lab: "Labs", concomitant: "Concom.",
};
const SET_LABEL: Record<string, string> = { core: "Demo cases", stress: "Edge cases", heldout: "Held-out cases" };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "n/a");

export default function EvalPage() {
  const [data, setData] = useState<EvalBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [live, setLive] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  useEffect(() => { fetch("/api/health").then((r) => r.json()).then((h) => setProvider(h.provider)).catch(() => {}); }, []);

  async function load(fresh = false, withModel = live) {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/eval?${fresh ? "fresh=1&" : ""}${withModel ? "live=1" : ""}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Evaluation failed.");
      setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Evaluation failed.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <>
      <Header current="eval" />
      <main className="page-wrap">
        <h1 className="page-title">Evaluation, run live against reference answers</h1>
        <p className="lede">
          Every case with a hand-written reference answer is run through the full agent graph on this server, and every field is scored, not just the flattering ones. A reference of “not stated” means the correct behaviour is to leave the field empty, so inventing a value counts as an error.
        </p>

        <div className="note-box">
          <b>Read this before quoting a number.</b> The demo and stress cases were written by the same team that wrote the extractor, so these are <b>author-tuned</b> results that show the controls work, not validated accuracy. A held-out set, written by someone who has not seen the code and run once, is the evidence that counts; drop it into <code>lib/cases/heldout.json</code> and it appears here as its own row. The case brief’s 70% time reduction is measured separately on the Time study page.
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn primary" onClick={() => load(true)} disabled={loading}>{loading ? "Running every case…" : "Re-run the evaluation now"}</button>
          {provider && provider !== "mock" && (
            <label className="check"><input type="checkbox" checked={live} onChange={(e) => { setLive(e.target.checked); load(false, e.target.checked); }} disabled={loading} /><span>Use the model reader (demo cases only, uses API quota)</span></label>
          )}
          {data && <span className="small muted">Ran {new Date(data.at).toLocaleString()} in {(data.ms / 1000).toFixed(1)} s{data.cached ? " (cached)" : ""}. Mode: {data.live ? `model (${[...new Set(data.scores.map((x) => x.mode))].join(", ")})` : "rules only"}{data.provider && data.provider !== "mock" ? `, provider ${data.provider}` : ""}.</span>}
        </div>
        {err && <p role="alert" style={{ color: "var(--conflict)", marginTop: 10 }}>{err}</p>}

        {data &&
          Object.entries(data.bySet)
            .filter(([, t]) => t.cases > 0)
            .map(([set, t]) => (
              <section key={set} style={{ marginTop: 28 }}>
                <h2 style={{ fontSize: 20 }}>{SET_LABEL[set]} <span className="muted" style={{ fontWeight: 500 }}>n = {t.cases}{set !== "heldout" ? ", author-tuned" : ""}</span></h2>
                <div className="tiles">
                  <div className="tile"><div className="v">{t.allCorrect}/{t.allTotal}</div><div className="k">All fields correct ({pct(t.allCorrect, t.allTotal)})</div></div>
                  <div className="tile"><div className="v">{t.critCorrect}/{t.critTotal}</div><div className="k">Critical fields correct</div></div>
                  <div className="tile"><div className="v">{t.unsupported}/{t.asserted}</div><div className="k">Values shown without a verified citation</div></div>
                  <div className="tile"><div className="v">{t.gapHits}/{t.gapExpected}</div><div className="k">Gaps found{t.gapFalse ? `, ${t.gapFalse} false` : ", none false"}</div></div>
                  <div className="tile"><div className="v">{t.routeOk}/{t.cases}</div><div className="k">Correct route (draft, escalate, hold)</div></div>
                  <div className="tile"><div className="v">{t.riskOk}/{t.cases}</div><div className="k">Correct queue priority</div></div>
                  <div className="tile"><div className="v">{t.flagsHit}/{t.flagsExpected}</div><div className="k">Expected safety flags raised</div></div>
                </div>
              </section>
            ))}

        {data && (
          <section style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 20, marginBottom: 10 }}>Field by field</h2>
            <div className="matrix-wrap">
              <table className="matrix">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Case</th>
                    {ICSR_FIELDS.map((f) => <th key={f.key} title={f.label}>{SHORT[f.key]}{f.critical ? "*" : ""}</th>)}
                    <th>Route</th><th>Priority</th><th>Valid</th><th>Flags</th><th>Narrative</th>
                  </tr>
                </thead>
                <tbody>
                  {data.scores.map((s) => (
                    <tr key={s.caseId}>
                      <td className="case" title={s.label}>{s.caseId}</td>
                      {s.fields.map((f) => (
                        <td key={f.key} className={f.correct ? "ok" : "no"} title={`${f.label}\nexpected: ${JSON.stringify(f.expected)}\ngot: ${JSON.stringify(f.got)} (${f.status})`}>{f.correct ? "✓" : "✗"}</td>
                      ))}
                      <td className={s.routeOk ? "ok" : "no"} title={`expected ${s.expectedRoute}`}>{s.route}</td>
                      <td className={s.riskOk ? "ok" : "no"} title={`expected ${s.expectedRisk}`}>{s.risk}</td>
                      <td className={s.validOk ? "ok" : "no"}>{s.validOk ? "✓" : "✗"}</td>
                      <td className={s.flagsExpected.every((x) => s.flagsFound.includes(x)) ? "ok" : "no"} title={`expected: ${s.flagsExpected.join(", ") || "none"}\nfound: ${s.flagsFound.join(", ") || "none"}`}>{s.flagsExpected.filter((x) => s.flagsFound.includes(x)).length}/{s.flagsExpected.length}</td>
                      <td className={s.narrativeUnsupported ? "no" : "ok"}>{s.route === "draft" ? `${s.narrativeClaims} claims, ${s.narrativeUnsupported} bad` : "none (halted)"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>Hover a cell to see the expected and extracted values. * critical field.</p>
          </section>
        )}

        <section style={{ marginTop: 32, maxWidth: "75ch" }}>
          <h2 style={{ fontSize: 20, marginBottom: 8 }}>What each number means</h2>
          <ul style={{ paddingLeft: 18, display: "grid", gap: 6, color: "var(--ink-2)" }}>
            <li><b>All fields correct</b>: 14 ICSR fields per case. Dates are compared after parsing; text fields must contain the reference’s key terms.</li>
            <li><b>Values without a verified citation</b>: the extractor discards any value whose quote is not found on the cited page or does not contain the value, so this is zero by construction. In live mode the trace also counts how many model citations were rejected; that is the hallucination rate the control catches.</li>
            <li><b>Gaps found</b>: missing or conflicting fields the system listed for follow-up, against the reference list. False gaps are fields flagged that the reference says are present.</li>
            <li><b>Route</b>: whether it drafted, escalated a critical conflict, or held an invalid case, as the reference expects.</li>
            <li><b>Narrative</b>: claims in the drafted narrative checked against verified fields; any unsupported claim means the draft is rejected.</li>
          </ul>
          <p className="small muted" style={{ marginTop: 10 }}>Command line: <code>npx tsx scripts/eval.ts</code> (no server) or <code>python3 eval/run_eval.py</code> against a running app.</p>
        </section>
      </main>
    </>
  );
}
