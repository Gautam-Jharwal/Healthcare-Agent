"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Header from "@/components/Header";
import { CASES, ICSR_FIELDS, DOC_KIND_LABEL, type CaseBundle } from "@/lib/cases";
import { matches } from "@/lib/engine/score";
import type { CaseFile } from "@/lib/engine/types";

type Condition = "manual" | "assisted";
type Row = { id: string; participant: string; caseId: string; condition: Condition; seconds: number; correct: number; critical: number; total: number; at: string };
const KEY = "sure-study-v1";

function load(): Row[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
function save(rows: Row[]) {
  try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch {}
}
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export default function Study() {
  const cases = useMemo(() => CASES.filter((c) => c.reference), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [participant, setParticipant] = useState("");
  const [caseId, setCaseId] = useState(cases[0].id);
  const [condition, setCondition] = useState<Condition>("manual");
  const [active, setActive] = useState<{ bundle: CaseBundle; condition: Condition; started: number } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loadingSure, setLoadingSure] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [clearArmed, setClearArmed] = useState(false);
  const [last, setLast] = useState<Row | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setRows(load()); }, []);
  useEffect(() => {
    if (active) { tick.current = setInterval(() => setNow(Date.now()), 250); return () => { if (tick.current) clearInterval(tick.current); }; }
  }, [active]);

  async function start() {
    const bundle = cases.find((c) => c.id === caseId)!;
    setValues({});
    setLast(null);
    setActive({ bundle, condition, started: Date.now() });
    if (condition === "assisted") {
      setLoadingSure(true);
      try {
        const res = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caseId }) });
        const text = await res.text();
        let file: CaseFile | null = null;
        for (const line of text.split("\n")) if (line.trim()) { const ev = JSON.parse(line); if (ev.file) file = ev.file; }
        if (file) setValues(Object.fromEntries(file.fields.map((f) => [f.key, f.value ?? ""])));
      } finally {
        setLoadingSure(false);
      }
    }
  }

  function finish() {
    if (!active) return;
    const ref = active.bundle.reference!;
    const year = new Date(active.bundle.documents[0].received).getUTCFullYear();
    let correct = 0, critical = 0;
    for (const f of ICSR_FIELDS) {
      const v = (values[f.key] ?? "").trim();
      const ok = matches(ref.fields[f.key] ?? null, v ? v : null, year);
      if (ok) { correct++; if (f.critical) critical++; }
    }
    const row: Row = { id: Math.random().toString(36).slice(2), participant: participant.trim() || "anon", caseId: active.bundle.id, condition: active.condition, seconds: Math.round((Date.now() - active.started) / 1000), correct, critical, total: ICSR_FIELDS.length, at: new Date().toISOString() };
    const next = [...rows, row];
    setRows(next); save(next); setLast(row); setActive(null);
  }

  function exportCsv() {
    const head = "participant,case,condition,seconds,fields_correct,critical_correct,fields_total,recorded_at";
    const body = rows.map((r) => [r.participant, r.caseId, r.condition, r.seconds, r.correct, r.critical, r.total, r.at].join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([head + "\n" + body], { type: "text/csv" }));
    a.download = "SURE_time_study.csv";
    a.click();
  }

  const by = (c: Condition) => rows.filter((r) => r.condition === c);
  const mm = median(by("manual").map((r) => r.seconds));
  const ma = median(by("assisted").map((r) => r.seconds));
  const acc = (c: Condition) => { const r = by(c); const t = r.reduce((a, b) => a + b.total, 0); return t ? Math.round((r.reduce((a, b) => a + b.correct, 0) / t) * 1000) / 10 : null; };
  const reduction = mm && ma ? Math.round((1 - ma / mm) * 1000) / 10 : null;
  const elapsed = active ? (now - active.started) / 1000 : 0;

  return (
    <>
      <Header current="study" />
      <main className="page-wrap">
        <h1 className="page-title">Time study: manual versus SURE-assisted</h1>
        <p className="lede">The case brief targets a 70% cut in drafting time. That number has to be measured, not asserted. Each session times one person completing the 14 ICSR fields for one case, either from the source documents alone or by checking SURE’s draft, then scores the fields against the reference answer.</p>

        <div className="note-box">
          <b>Protocol.</b> Use a crossover: each participant does half their cases manually and half assisted, alternating which comes first, and never sees the same case twice. Four participants with four cases each gives 16 timed sessions. Report the median, the n and the accuracy alongside the time. A faster draft with lower accuracy is not a win.
        </div>

        {!active && (
          <div className="card" style={{ marginTop: 18 }}>
            <header><h2>Start a session</h2></header>
            <div className="body" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
              <label className="small" style={{ display: "grid", gap: 4 }}>Participant code<input className="field-input" value={participant} onChange={(e) => setParticipant(e.target.value)} placeholder="e.g. P1" /></label>
              <label className="small" style={{ display: "grid", gap: 4 }}>Case
                <select className="field-input" value={caseId} onChange={(e) => setCaseId(e.target.value)}>{cases.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.label}</option>)}</select>
              </label>
              <label className="small" style={{ display: "grid", gap: 4 }}>Condition
                <select className="field-input" value={condition} onChange={(e) => setCondition(e.target.value as Condition)}><option value="manual">Manual (documents only)</option><option value="assisted">Assisted (check SURE’s draft)</option></select>
              </label>
              <button className="btn primary" onClick={start}>Start the timer</button>
            </div>
            {last && <p className="small" role="status" style={{ padding: "0 18px 16px" }}>Saved: {last.caseId}, {last.condition}, {fmt(last.seconds)}, {last.correct}/{last.total} fields correct.</p>}
          </div>
        )}

        {active && (
          <>
            <div className="card" style={{ marginTop: 18 }}>
              <div className="body" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", paddingTop: 16 }}>
                <span className="timer" aria-live="off">{fmt(elapsed)}</span>
                <span><b>{active.bundle.id}</b> · {active.condition === "manual" ? "manual" : "assisted"}{loadingSure ? " · SURE is preparing the draft (this counts as time)" : ""}</span>
                <span style={{ flex: 1 }} />
                <button className="btn human" onClick={finish}>Stop and score</button>
                <button className="btn ghost" onClick={() => setActive(null)}>Abandon</button>
              </div>
            </div>
            <div className="study-grid">
              <div className="card"><header><h2>Source documents</h2></header>
                <div className="body docs-pane">
                  {active.bundle.documents.map((d) => d.pages.map((p) => (
                    <div key={d.id + p.n}><b className="small">{d.title} · {DOC_KIND_LABEL[d.kind]} · p.{p.n}{p.unreadable ? " (unreadable)" : ""}</b><pre style={{ opacity: p.unreadable ? 0.5 : 1 }}>{p.text}</pre></div>
                  )))}
                </div>
              </div>
              <div className="card"><header><h2>{active.condition === "manual" ? "Complete the case fields" : "Check and correct SURE’s fields"}</h2></header>
                <div className="body form-grid">
                  {ICSR_FIELDS.map((f) => (
                    <div key={f.key} style={{ display: "contents" }}>
                      <label htmlFor={`sf-${f.key}`}>{f.label}{f.critical ? " *" : ""}</label>
                      <input id={`sf-${f.key}`} className="field-input" value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} placeholder="Leave blank if not stated" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 20 }}>Results so far</h2>
          <div className="tiles">
            <div className="tile"><div className="v">{mm != null ? fmt(mm) : "—"}</div><div className="k">Median manual time (n = {by("manual").length})</div></div>
            <div className="tile"><div className="v">{ma != null ? fmt(ma) : "—"}</div><div className="k">Median assisted time (n = {by("assisted").length})</div></div>
            <div className="tile"><div className="v">{reduction != null ? `${reduction}%` : "—"}</div><div className="k">Reduction in median time (target 70%)</div></div>
            <div className="tile"><div className="v">{acc("manual") ?? "—"}{acc("manual") != null ? "%" : ""} / {acc("assisted") ?? "—"}{acc("assisted") != null ? "%" : ""}</div><div className="k">Field accuracy, manual / assisted</div></div>
          </div>
          {rows.length > 0 ? (
            <>
              <table className="simple">
                <thead><tr><th>Participant</th><th>Case</th><th>Condition</th><th>Time</th><th>Fields correct</th><th>Critical correct</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.id}><td>{r.participant}</td><td>{r.caseId}</td><td>{r.condition}</td><td>{fmt(r.seconds)}</td><td>{r.correct}/{r.total}</td><td>{r.critical}/7</td></tr>)}</tbody>
              </table>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn" onClick={exportCsv}>Download CSV</button>
                {!clearArmed ? <button className="btn ghost" onClick={() => setClearArmed(true)}>Clear results</button> : <button className="btn danger" onClick={() => { setRows([]); save([]); setClearArmed(false); }}>Click again to delete all {rows.length} rows</button>}
              </div>
            </>
          ) : (
            <p className="muted">No sessions yet. Results stay in this browser only; download the CSV to keep them.</p>
          )}
        </section>
      </main>
    </>
  );
}
