import { CASES } from "../lib/cases";
import { runGraphToEnd } from "../lib/agents/graph";

(async () => {
  for (const c of CASES) {
    const f = await runGraphToEnd(c);
    const sourced = f.fields.filter(x => x.status === "sourced");
    console.log("\n=== " + c.label + "  (" + c.demoRole + ", mode=" + f.mode + ") ===");
    console.log("  sourced:", sourced.length + "/" + f.fields.length,
                "| gaps:", f.gaps.length,
                "| conflicts:", f.conflicts.length,
                "| halted:", f.halted);
    console.log("  risk:", f.riskRank?.level);
    for (const x of f.fields) {
      const cite = x.citations[0] ? ` <- ${x.citations[0].docTitle} p.${x.citations[0].page}` : "";
      console.log(`    ${x.status.padEnd(8)} ${x.label.padEnd(16)} ${String(x.value ?? (x.candidates ? "candidates: " + x.candidates.join(" | ") : "—")).slice(0,58)}${cite}`);
    }
    if (f.halted) console.log("  HALT:", f.haltReason?.slice(0, 120));
    console.log("  trace:", f.trace.map(t => t.agent + (t.stopTriggered ? "*" : "")).join(" -> "));
  }
})();
