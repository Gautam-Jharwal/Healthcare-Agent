"use client";

import Link from "next/link";
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

  /* view state */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);

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

  useEffect(() => {
    if (drawerOpen) traceEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [trace.length, drawerOpen]);

  /* Close the drawer with Escape, the way any overlay should behave. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = useCallback(async (payload: Record<string, unknown>) => {
    setRunning(true); setTrace([]); setRouting(null); setFile(null);
    setSelected(null); setEdits({}); setApproved(false); setOpenStep(null);
    setDrawerOpen(true); // the whole point of the demo is watching the agents work

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
          // A step that hit its stop condition expands itself: it is the one
          // thing a reviewer must read rather than scroll past.
          if (ev.trace?.stopTriggered) setOpenStep(ev.trace.agent);
          await new Promise((r) => setTimeout(r, 320));
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
  const activeCase = cases.find((c) => c.id === caseId);

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
        <Link href="/" className="back">← Overview</Link>
        <div className={`mode ${mode}`}>
          {mode === "live" ? `Live · ${modelVersion}` : "Seeded · deterministic"}
        </div>
        <button
          className={`hdr-btn ${drawerOpen ? "on" : ""}`}
          onClick={() => setDrawerOpen((o) => !o)}
          aria-expanded={drawerOpen}
        >
          {running && <span className="dot" />}
          Agent trace
          <span className="cnt">{trace.length}/8</span>
        </button>
      </header>

      <div className="banner">
        All cases are synthetic and fabricated for demonstration. No real patient data is used. Not for clinical or regulatory use.
      </div>

      {/* ------------------ case control bar ------------------ */}
      <div className="bar">
        <span className="lbl">Case bundle</span>
        {cases.map((c) => (
          <button
            key={c.id}
            className={`chip ${caseId === c.id ? "on" : ""}`}
            onClick={() => setCaseId(c.id)}
            title={c.blurb}
          >
            <span className="nm">{c.label}</span>
            <span className={`role ${c.demoRole}`}>{c.demoRole === "stop" ? "halts" : c.demoRole}</span>
          </button>
        ))}
        <div className="spacer" />
        <button className="btn ghost auto" onClick={() => setPasteOpen((p) => !p)}>
          {pasteOpen ? "Hide paste panel" : "Paste your own"}
        </button>
        <button className="btn auto" disabled={running || !caseId} onClick={() => run({ caseId })}>
          {running ? "Agents running…" : "Run the agent chain"}
        </button>
      </div>

      <div className="work">
        {/* ------------------ main column ------------------ */}
        <div className="main">
          {pasteOpen && (
            <div className="p">
              <div className="p-h soft">Run on your own source text</div>
              <div className="p-b">
                <textarea
                  rows={5}
                  placeholder="Paste a physician note, patient diary or lab report here…"
                  value={uploadText}
                  onChange={(e) => setUploadText(e.target.value)}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10 }}>
                  <button
                    className="btn auto"
                    disabled={running || uploadText.trim().length < 40}
                    onClick={() => run({ uploaded: [{ title: "Pasted document", kind: "physician_note", text: uploadText }] })}
                  >
                    Run on pasted text
                  </button>
                  <p className="note" style={{ flex: 1 }}>
                    Pasted text has no reference answer, so accuracy is not scored for that run.
                  </p>
                </div>
              </div>
            </div>
          )}

          {file?.halted && (
            <div className="halt">
              <div className="t">⛔ Chain halted at “{file.haltAgent}” — no narrative produced</div>
              <div className="m">{file.haltReason}</div>
            </div>
          )}

          <div className="p">
            <div className="p-h">
              Case file
              {activeCase && (
                <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: "none", opacity: .85 }}>
                  {activeCase.label}
                </span>
              )}
              {file?.riskRank && (
                <span className={`pill ${file.riskRank.level}`} style={{ marginLeft: "auto" }}>
                  {file.riskRank.level}
                </span>
              )}
            </div>
            {file ? (
              <>
                <div className="summary-line">
                  <b>{sourced.length}</b> of {file.fields.length} fields sourced · <b>{criticalGaps.length}</b> open gap(s) ·{" "}
                  <b>{file.conflicts.length}</b> conflict(s) — click any field to see the source it came from
                </div>
                {file.fields.map((f) => (
                  <FieldRow
                    key={f.key}
                    f={f}
                    selected={selected === f.key}
                    edit={edits[f.key]}
                    source={selected === f.key ? sourceView : null}
                    onSelect={() => setSelected(selected === f.key ? null : f.key)}
                    onEdit={(v) => setEdits((e) => ({ ...e, [f.key]: v }))}
                  />
                ))}
              </>
            ) : (
              <div className="empty">
                <div className="ico">▶</div>
                <div className="t">{running ? "Agents are working…" : "Pick a case and run the chain"}</div>
                <div className="s">
                  Eight bounded agents read the source documents, cite every value they extract,
                  and stop rather than guess. The trace on the right records each step.
                </div>
              </div>
            )}
          </div>

          {file?.followUpQuery && (
            <div className="p">
              <div className="p-h soft a">Follow-up query — drafted, not sent</div>
              <div className="p-b"><div className="q-box">{file.followUpQuery}</div></div>
            </div>
          )}

          {file?.narrative && (
            <div className="p">
              <div className="p-h soft">ICSR narrative draft</div>
              <div className="p-b">
                <div className="draft">{file.narrative}</div>
                <p className="note" style={{ marginTop: 10 }}>
                  Built only from fields marked <b>sourced</b>. Unresolved items are described as not stated, never filled in.
                </p>
              </div>
            </div>
          )}

          {file && !running && (
            <div className="p">
              <div className="p-h ink">Human decision</div>
              <div className="p-b">
                {approved ? (
                  <p className="note">
                    <b>Recorded.</b> {file.halted ? "Case escalated for adjudication." : "Case approved by reviewer."} The decision is in the audit export.
                  </p>
                ) : (
                  <p className="note" style={{ marginBottom: 12 }}>
                    {file.halted
                      ? "SURE refused to draft this case. A qualified reviewer must adjudicate the conflict before processing continues."
                      : "Nothing can be exported until a qualified reviewer signs off. SURE never submits to a regulator."}
                  </p>
                )}
                <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
                  {!approved && (
                    <button className={`btn auto ${file.halted ? "danger" : "ok"}`} disabled={!canApprove} onClick={() => setApproved(true)}>
                      {file.halted ? "Acknowledge escalation" : "Approve case"}
                    </button>
                  )}
                  <button className="btn ghost auto" onClick={exportAudit}>
                    Export audit trail (JSON)
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ------------------ trace drawer ------------------ */}
        {drawerOpen && (
          <aside className="drawer">
            <div className="drawer-h">
              <div>
                <div className="t">Agent trace &amp; audit log</div>
                <div className="s">
                  {trace.length}/8 steps · every step records its stop condition
                </div>
              </div>
              <button className="x" onClick={() => setDrawerOpen(false)} aria-label="Close trace">✕</button>
            </div>
            <div className="drawer-b">
              {trace.length === 0 && !running && (
                <p className="note">Each agent appears here as it runs, with the boundary it checked before handing off.</p>
              )}
              {AGENT_ORDER.map(([key, label], i) => {
                const t = trace.find((x) => x.agent === key);
                const isNext = !t && running && trace.length === i;
                if (!t && !isNext) return null;
                const open = openStep === key;
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
                      {t ? (
                        <>
                          <button className="tr-top" onClick={() => setOpenStep(open ? null : key)}>
                            <div style={{ minWidth: 0 }}>
                              <div className="n">{t.seq}. {t.agentLabel}</div>
                              <div className="s">{t.summary}</div>
                              <div className="meta">
                                {t.durationMs} ms{t.modelVersion ? ` · ${t.modelVersion}` : " · deterministic"}
                                {t.toolCalls.length > 0 && ` · ${t.toolCalls.length} tool call${t.toolCalls.length > 1 ? "s" : ""}`}
                              </div>
                            </div>
                            <span className={`caret ${open ? "open" : ""}`}>▶</span>
                          </button>
                          {t.fallbackReason && <div className="fbk">⚠ {t.fallbackReason}</div>}
                          {open && (
                            <div className="tr-detail">
                              {t.toolCalls.map((tc, j) => (
                                <div className="tool" key={j}>↳ {tc.tool}({tc.input}) → {tc.output}</div>
                              ))}
                              <div className={`stopc ${t.stopTriggered ? "" : "ok"}`}>
                                STOP CONDITION {t.stopTriggered ? "— TRIGGERED" : "checked"}: {t.stopConditionChecked}
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="n" style={{ color: "var(--slate-2)" }}>{i + 1}. {label}…</div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={traceEnd} />
            </div>
          </aside>
        )}
      </div>
    </>
  );
}

interface SourceView { title: string; page: number; text: string; quote: string; found: boolean }

function FieldRow({
  f, selected, edit, source, onSelect, onEdit,
}: {
  f: ExtractedField; selected: boolean; edit?: string; source: SourceView | null;
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
        <div className="expand" onClick={(e) => e.stopPropagation()}>
          {source ? (
            <>
              <div className="src-h">{source.title} · page {source.page}</div>
              <div className="src">
                {source.found ? highlight(source.text, source.quote) : source.text}
              </div>
            </>
          ) : (
            <p className="note" style={{ paddingTop: 12 }}>
              No surviving citation for this field, so there is no source to show. That is
              why it reads as a gap rather than a value.
            </p>
          )}
          <div className="fix-h">Reviewer correction</div>
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
