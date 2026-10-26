"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaseFile, ExtractedField, TraceEntry } from "@/lib/agents/types";
import type { RoutingDecision } from "@/lib/agents/graph";

interface CaseMeta { id: string; label: string; blurb: string; demoRole: "clean" | "gaps" | "stop"; docs: number }

const AGENT_ORDER = [
  ["intake", "Intake & classification"],
  ["extract", "Evidence extraction"],
  ["terminology", "Terminology mapping"],
  ["evidenceGraph", "Evidence graph"],
  ["risk", "Risk prioritisation"],
  ["completeness", "Completeness check"],
  ["draft", "Narrative drafting"],
  ["humanGate", "Qualified reviewer"],
] as const;

export default function Page() {
  const [cases, setCases] = useState<CaseMeta[]>([]);
  const [caseId, setCaseId] = useState<string>("");
  const [file, setFile] = useState<CaseFile | null>(null);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [routing, setRouting] = useState<RoutingDecision | null>(null);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<"live" | "seeded">("seeded");
  const [modelVersion, setModelVersion] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [approved, setApproved] = useState(false);
  const [uploadText, setUploadText] = useState("");
  const traceEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/run")
      .then((r) => r.json())
      .then((d) => {
        setCases(d.cases);
        setCaseId(d.cases[0]?.id ?? "");
        setMode(d.mode);
        setModelVersion(d.modelVersion);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { traceEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [trace.length]);

  const run = useCallback(async (payload: Record<string, unknown>) => {
    setRunning(true); setTrace([]); setRouting(null); setFile(null);
    setSelected(null); setEdits({}); setApproved(false);

    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const reader = res.body?.getReader();
    if (!reader) { setRunning(false); return; }
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.kind === "meta") { setMode(ev.mode); setModelVersion(ev.modelVersion); }
        if (ev.kind === "step") {
          setFile(ev.file);
          setTrace((t) => [...t, ev.trace]);
          await new Promise((r) => setTimeout(r, 320)); // let the reviewer watch it think
        }
        if (ev.kind === "routing") { setRouting(ev.routing); await new Promise((r) => setTimeout(r, 420)); }
        if (ev.kind === "done") setFile(ev.file);
      }
    }
    setRunning(false);
  }, []);

  const selField = useMemo(
    () => file?.fields.find((f) => f.key === selected) ?? null,
    [file, selected]
  );

  const sourceView = useMemo(() => {
    if (!selField || !file) return null;
    const c = selField.citations[0];
    if (!c) return null;
    const doc = file.documents.find((d) => d.id === c.docId);
    const page = doc?.pages.find((p) => p.n === c.page);
    if (!doc || !page) return null;
    const idx = page.text.toLowerCase().indexOf(c.quote.slice(0, 40).toLowerCase());
    return { title: doc.title, page: c.page, text: page.text, quote: c.quote, found: idx >= 0 };
  }, [selField, file]);

  const criticalGaps = file?.fields.filter((f) => f.status === "gap") ?? [];
  const sourced = file?.fields.filter((f) => f.status === "sourced") ?? [];
  const canApprove = !!file && !running && !approved;

  function exportAudit() {
    if (!file) return;
    const payload = {
      case: file.caseId,
      generatedAt: new Date().toISOString(),
      mode: file.mode,
      modelVersion: file.modelVersion,
      halted: file.halted,
      haltReason: file.haltReason,
      fields: file.fields.map((f) => ({ ...f, reviewerEdit: edits[f.key] ?? null })),
      gaps: file.gaps,
      conflicts: file.conflicts,
      riskRank: file.riskRank,
      narrative: file.narrative,
      followUpQuery: file.followUpQuery,
      approvals: approved ? [{ at: new Date().toISOString(), by: "demo reviewer", decision: file.halted ? "rejected" : "approved" }] : [],
      trace: file.trace,
      disclaimer: "Synthetic demonstration data. Not for clinical or regulatory use.",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `SURE_audit_${file.caseId}.json`;
    a.click();
  }

  return (
    <>
      <header className="hdr">
        <div className="hdr-mark">SURE</div>
        <div>
          <h1>Safety Understanding, Risk &amp; Evidence</h1>
          <div className="sub">Agentic ICSR case processing · Product Avengers · ABHIKALP 2026</div>
        </div>
        <div className="spacer" />
        <div className={`mode ${mode}`}>
          {mode === "live" ? `Live · ${modelVersion}` : "Seeded · deterministic"}
        </div>
      </header>

      <div className="banner">
        All cases below are synthetic and fabricated for demonstration. No real patient data is used. Not for clinical or regulatory use.
      </div>

      <div className="grid">
        {/* ------------------ LEFT ------------------ */}
        <div className="col">
          <div className="p">
            <div className="p-h ink">Case bundles</div>
            <div className="p-b">
              {cases.map((c) => (
                <button key={c.id} className={`case ${caseId === c.id ? "on" : ""}`} onClick={() => setCaseId(c.id)}>
                  <div className="t">
                    {c.label}
                    <span className={`role ${c.demoRole}`}>{c.demoRole === "stop" ? "halts" : c.demoRole}</span>
                  </div>
                  <div className="b">{c.blurb}</div>
                </button>
              ))}
              <button className="btn" disabled={running || !caseId} onClick={() => run({ caseId })}>
                {running ? "Agents running…" : "Run the agent chain"}
              </button>
            </div>
          </div>

          <div className="p">
            <div className="p-h ink">Or paste your own source</div>
            <div className="p-b">
              <textarea
                rows={6}
                placeholder="Paste a physician note, patient diary or lab report here…"
                value={uploadText}
                onChange={(e) => setUploadText(e.target.value)}
              />
              <button
                className="btn ghost"
                style={{ marginTop: 8 }}
                disabled={running || uploadText.trim().length < 40}
                onClick={() => run({ uploaded: [{ title: "Pasted document", kind: "physician_note", text: uploadText }] })}
              >
                Run on pasted text
              </button>
              <p className="note" style={{ marginTop: 8 }}>
                Uploaded text has no reference answer, so accuracy is not scored for that run.
              </p>
            </div>
          </div>

          {sourceView && (
            <div className="p">
              <div className="p-h">Source trail</div>
              <div className="p-b">
                <div className="src-h">{sourceView.title} · page {sourceView.page}</div>
                <div className="src">
                  {sourceView.found
                    ? highlight(sourceView.text, sourceView.quote)
                    : sourceView.text}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ------------------ CENTRE ------------------ */}
        <div className="col">
          {file?.halted && (
            <div className="halt">
              <div className="t">⛔ Chain halted at “{file.haltAgent}” — no narrative produced</div>
              <div className="m">{file.haltReason}</div>
            </div>
          )}

          <div className="p">
            <div className="p-h">
              Case file
              {file?.riskRank && (
                <span className={`pill ${file.riskRank.level}`} style={{ marginLeft: "auto" }}>
                  {file.riskRank.level}
                </span>
              )}
            </div>
            {file ? (
              <>
                <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--slate)", borderBottom: "1px solid var(--rule-soft)" }}>
                  <b>{sourced.length}</b> of {file.fields.length} fields sourced · <b>{criticalGaps.length}</b> open gap(s) ·{" "}
                  <b>{file.conflicts.length}</b> conflict(s) — click any field to see where it came from
                </div>
                {file.fields.map((f) => (
                  <FieldRow
                    key={f.key}
                    f={f}
                    selected={selected === f.key}
                    edit={edits[f.key]}
                    onSelect={() => setSelected(selected === f.key ? null : f.key)}
                    onEdit={(v) => setEdits((e) => ({ ...e, [f.key]: v }))}
                  />
                ))}
              </>
            ) : (
              <div className="p-b"><p className="note">Pick a case and run the chain.</p></div>
            )}
          </div>

          {file?.followUpQuery && (
            <div className="p">
              <div className="p-h amber">Follow-up query — drafted, not answered</div>
              <div className="p-b"><div className="q-box">{file.followUpQuery}</div></div>
            </div>
          )}

          {file?.narrative && (
            <div className="p">
              <div className="p-h">ICSR narrative draft</div>
              <div className="p-b">
                <div className="draft">{file.narrative}</div>
                <p className="note" style={{ marginTop: 8 }}>
                  Built only from fields marked <b>Sourced</b>. Unresolved items are described as not stated, never filled in.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ------------------ RIGHT ------------------ */}
        <div className="col">
          <div className="p">
            <div className="p-h violet">Agent trace &amp; audit log</div>
            <div className="p-b">
              {trace.length === 0 && !running && <p className="note">The trace appears here as each agent runs.</p>}
              {AGENT_ORDER.map(([key, label], i) => {
                const t = trace.find((x) => x.agent === key);
                const isNext = !t && running && trace.length === i;
                if (!t && !isNext) return null;
                return (
                  <div key={key}>
                    {key === "draft" && routing && (
                      <div className="route">
                        <div className="q">Routing decision · {routing.condition}</div>
                        <div className="a">→ {routing.chose}</div>
                        <div className="w">{routing.because}</div>
                      </div>
                    )}
                    <div className={`tr ${t?.stopTriggered ? "stop" : isNext ? "run" : ""}`}>
                      <div className="n">{t ? `${t.seq}. ${t.agentLabel}` : `${i + 1}. ${label}…`}</div>
                      {t && (
                        <>
                          <div className="s">{t.summary}</div>
                          {t.toolCalls.map((tc, j) => (
                            <div className="tool" key={j}>↳ {tc.tool}({tc.input}) → {tc.output}</div>
                          ))}
                          <div className="meta">
                            {t.durationMs} ms{t.modelVersion ? ` · ${t.modelVersion}` : " · deterministic"}
                          </div>
                          <div className="stopc">STOP CONDITION {t.stopTriggered ? "— TRIGGERED" : "checked"}: {t.stopConditionChecked}</div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={traceEnd} />
            </div>
          </div>

          {file && !running && (
            <div className="p">
              <div className="p-h ink">Human decision</div>
              <div className="p-b">
                {approved ? (
                  <p className="note">
                    <b>Recorded.</b> {file.halted ? "Case escalated for adjudication." : "Case approved by reviewer."} The decision is in the audit export.
                  </p>
                ) : (
                  <>
                    <p className="note" style={{ marginBottom: 9 }}>
                      {file.halted
                        ? "SURE refused to draft this case. A qualified reviewer must adjudicate the conflict before processing continues."
                        : "Nothing can be exported until a qualified reviewer signs off. SURE never submits to a regulator."}
                    </p>
                    <div style={{ display: "flex", gap: 7 }}>
                      <button className={`btn ${file.halted ? "danger" : "ok"}`} disabled={!canApprove} onClick={() => setApproved(true)}>
                        {file.halted ? "Acknowledge escalation" : "Approve case"}
                      </button>
                    </div>
                  </>
                )}
                <button className="btn ghost" style={{ marginTop: 8 }} onClick={exportAudit}>
                  Export audit trail (JSON)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function FieldRow({
  f, selected, edit, onSelect, onEdit,
}: {
  f: ExtractedField; selected: boolean; edit?: string;
  onSelect: () => void; onEdit: (v: string) => void;
}) {
  const shown = edit ?? f.value;
  return (
    <>
      <div className={`f ${selected ? "sel" : ""}`} onClick={onSelect}>
        <div className="k">{f.label}</div>
        <div className="v">
          <span className={shown ? (f.status === "gap" ? "amber" : "") : "none"}>
            {shown ?? (f.candidates?.length ? "unresolved" : "not stated")}
          </span>
          {f.candidates?.length ? (
            <div className="cands">candidates: {f.candidates.join("  ·  ")}</div>
          ) : null}
          {f.citations[0] && (
            <div className="cite">
              ↳ {f.citations[0].docTitle}, p.{f.citations[0].page}
              {f.citations[0].verified && " · citation verified"}
            </div>
          )}
          {edit && <div className="cite" style={{ color: "var(--blue)" }}>↳ corrected by reviewer (original preserved in audit)</div>}
        </div>
        <span className={`badge ${f.status}`}>{f.status}</span>
      </div>
      {selected && (
        <div style={{ padding: "0 12px 10px 131px" }} onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            placeholder="Correct this field…"
            value={edit ?? ""}
            onChange={(e) => onEdit(e.target.value)}
          />
        </div>
      )}
    </>
  );
}

function highlight(text: string, quote: string) {
  const probe = quote.slice(0, 60);
  const i = text.toLowerCase().indexOf(probe.toLowerCase());
  if (i < 0) return text;
  const end = Math.min(text.length, i + quote.length);
  return (
    <>
      {text.slice(0, i)}
      <span className="hl">{text.slice(i, end)}</span>
      {text.slice(end)}
    </>
  );
}
