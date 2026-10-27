"use client";

import { useEffect, useState } from "react";

export type NodeId =
  | "intake" | "extract" | "review" | "terminology" | "evidenceGraph" | "risk" | "completeness"
  | "route" | "draft" | "escalate" | "hold" | "humanGate";
export type NodeState = "idle" | "running" | "done" | "stopped" | "held" | "human" | "skipped";

const NODES: { id: NodeId; x: number; y: number; label: string; sub?: string; shape?: "diamond"; optional?: boolean }[] = [
  { id: "intake", x: 70, y: 92, label: "Intake", sub: "quarantine, redact" },
  { id: "extract", x: 192, y: 92, label: "Extract", sub: "two readers" },
  { id: "review", x: 314, y: 92, label: "Reviewer", sub: "decisions", optional: true },
  { id: "terminology", x: 436, y: 92, label: "Terminology", sub: "propose code" },
  { id: "evidenceGraph", x: 558, y: 92, label: "Evidence graph", sub: "conflicts, links" },
  { id: "risk", x: 680, y: 92, label: "Risk", sub: "rules, clock" },
  { id: "completeness", x: 802, y: 92, label: "Completeness", sub: "validity, gaps" },
  { id: "route", x: 914, y: 92, label: "Route", shape: "diamond" },
  { id: "draft", x: 1030, y: 40, label: "Draft", sub: "verified claims" },
  { id: "escalate", x: 1030, y: 92, label: "Escalate", sub: "conflict" },
  { id: "hold", x: 1030, y: 144, label: "Hold", sub: "not yet valid" },
  { id: "humanGate", x: 1160, y: 92, label: "Human gate", sub: "always" },
];
const W = 108, H = 44;

const EDGES: [NodeId, NodeId, string?][] = [
  ["intake", "extract"], ["extract", "review"], ["review", "terminology"], ["terminology", "evidenceGraph"],
  ["evidenceGraph", "risk"], ["risk", "completeness"], ["completeness", "route"],
  ["route", "draft", "draft"], ["route", "escalate", "esc"], ["route", "hold", "hold"],
  ["draft", "humanGate"], ["escalate", "humanGate"], ["hold", "humanGate"],
];

function pos(id: NodeId) { return NODES.find((n) => n.id === id)!; }

function edgePath(a: NodeId, b: NodeId) {
  const A = pos(a), B = pos(b);
  const ax = A.shape === "diamond" ? A.x + 26 : A.x + W / 2;
  const bx = B.shape === "diamond" ? B.x - 26 : B.x - W / 2;
  if (A.y === B.y) return `M${ax},${A.y} L${bx - 4},${B.y}`;
  const mx = (ax + bx) / 2;
  return `M${ax},${A.y} C${mx},${A.y} ${mx},${B.y} ${bx - 4},${B.y}`;
}

export interface PipelineProps {
  states: Partial<Record<NodeId, NodeState>>;
  route: "draft" | "escalate" | "hold" | null;
  running: NodeId | null;
  loops: { extract: boolean; draft: boolean };
  caption?: string;
}

export default function Pipeline({ states, route, running, loops, caption }: PipelineProps) {
  const st = (id: NodeId): NodeState => (running === id ? "running" : states[id] ?? "idle");
  const edgeClass = (a: NodeId, b: NodeId, kind?: string) => {
    const sa = st(a), sb = st(b);
    if (sb === "skipped" || sa === "skipped") return "edge off";
    if (running === b) return "edge lit";
    if (kind === "esc" && route === "escalate") return "edge esc";
    if (kind === "hold" && route === "hold") return "edge hold";
    if (kind && route && kind !== (route === "draft" ? "draft" : route === "escalate" ? "esc" : "hold")) return "edge off";
    if (sa !== "idle" && sb !== "idle") return "edge done";
    return "edge";
  };
  return (
    <div className="pipe-wrap">
      <svg className="pipe" viewBox="0 0 1230 186" role="img" aria-label={caption ?? "Agent graph"}>
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" style={{ color: "var(--ink-3)" }} />
          </marker>
        </defs>
        {EDGES.map(([a, b, k]) => (
          <path key={a + b} d={edgePath(a, b)} className={edgeClass(a, b, k)} markerEnd="url(#arr)" />
        ))}
        {/* self-correction loops */}
        <path className={`loop ${loops.extract ? "used" : ""}`} d={`M${pos("extract").x - 22},${92 - H / 2} C${pos("extract").x - 30},28 ${pos("extract").x + 30},28 ${pos("extract").x + 22},${92 - H / 2 - 2}`} markerEnd="url(#arr)" />
        <text className={`loop-label ${loops.extract ? "used" : ""}`} x={pos("extract").x} y={24}>self-correct</text>
        <path className={`loop ${loops.draft ? "used" : ""}`} d={`M${pos("draft").x + W / 2},${40 - 8} C${pos("draft").x + W / 2 + 26},6 ${pos("draft").x + 10},2 ${pos("draft").x + 14},${40 - H / 2 - 2}`} markerEnd="url(#arr)" />
        <text className={`loop-label ${loops.draft ? "used" : ""}`} x={pos("draft").x + W / 2 + 30} y={14}>redraft</text>

        {NODES.map((n) => {
          const s = st(n.id);
          const cls = `node ${s}${n.optional ? " optional" : ""}`;
          return (
            <g key={n.id} className={cls}>
              <title>{`${n.label}: ${s}`}</title>
              {n.shape === "diamond" ? (
                <path className="shape" d={`M${n.x},${n.y - 26} L${n.x + 26},${n.y} L${n.x},${n.y + 26} L${n.x - 26},${n.y} Z`} />
              ) : (
                <rect x={n.x - W / 2} y={n.y - H / 2} width={W} height={H} rx={n.id === "humanGate" ? 22 : 8} />
              )}
              <text x={n.x} y={n.sub ? n.y - 7 : n.y}>{n.label}</text>
              {n.sub && <text className="sub" x={n.x} y={n.y + 10}>{n.sub}</text>}
            </g>
          );
        })}
      </svg>
      <div className="pipe-legend" aria-hidden>
        <span className="l1">ran</span><span className="l2">halted</span><span className="l3">held</span><span className="l4">human</span>
      </div>
    </div>
  );
}

/** Derives node states from a run's trace and routing decision. */
export function pipelineFromRun(
  agents: string[],
  route: "draft" | "escalate" | "hold" | null,
  running: boolean,
  done: boolean,
  draftHalted: boolean,
): { states: Partial<Record<NodeId, NodeState>>; running: NodeId | null } {
  const states: Partial<Record<NodeId, NodeState>> = {};
  const order: NodeId[] = ["intake", "extract", "review", "terminology", "evidenceGraph", "risk", "completeness"];
  for (const a of agents) if (order.includes(a as NodeId)) states[a as NodeId] = "done";
  if (!agents.includes("review") && (agents.includes("terminology") || done)) states.review = "skipped";
  if (route) {
    states.route = "done";
    states.draft = route === "draft" ? (agents.includes("draft") ? "done" : "idle") : "skipped";
    states.escalate = route === "escalate" ? "stopped" : "skipped";
    states.hold = route === "hold" ? "held" : "skipped";
  }
  if (draftHalted && route === "draft") states.draft = "stopped";
  if (agents.includes("humanGate")) states.humanGate = "human";
  let next: NodeId | null = null;
  if (running) {
    const seq: NodeId[] = ["intake", "extract", "terminology", "evidenceGraph", "risk", "completeness", "route"];
    next = seq.find((s) => !(s === "route" ? route : agents.includes(s))) ?? null;
    if (!next && route === "draft" && !agents.includes("draft")) next = "draft";
    if (!next && !agents.includes("humanGate")) next = "humanGate";
  }
  return { states, running: next };
}

/** Self-playing version for the overview page: replays the case that refuses to draft. */
export function PipelineReplay() {
  const script: { agents: string[]; route: "draft" | "escalate" | "hold" | null }[] = [
    { agents: [], route: null },
    { agents: ["intake"], route: null },
    { agents: ["intake", "extract"], route: null },
    { agents: ["intake", "extract", "terminology"], route: null },
    { agents: ["intake", "extract", "terminology", "evidenceGraph"], route: null },
    { agents: ["intake", "extract", "terminology", "evidenceGraph", "risk"], route: null },
    { agents: ["intake", "extract", "terminology", "evidenceGraph", "risk", "completeness"], route: null },
    { agents: ["intake", "extract", "terminology", "evidenceGraph", "risk", "completeness"], route: "escalate" },
    { agents: ["intake", "extract", "terminology", "evidenceGraph", "risk", "completeness", "draft", "humanGate"], route: "escalate" },
  ];
  const [i, setI] = useState(script.length - 1);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setI(0);
    let k = 0;
    const t = setInterval(() => {
      k = (k + 1) % (script.length + 5);
      setI(Math.min(k, script.length - 1));
    }, 700);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const s = script[i];
  const p = pipelineFromRun(s.agents, s.route, i < script.length - 1, i === script.length - 1, false);
  return <Pipeline states={p.states} route={s.route} running={p.running} loops={{ extract: false, draft: false }} caption="Replay: case IN-2026-0433 runs through the agents and is escalated instead of drafted" />;
}
