/** Prints the trace for every case:  npx tsx scripts/smoke.ts [caseId] */
import { CASES } from "../lib/cases";
import { runGraphToEnd } from "../lib/engine/graph";

(async () => {
  const only = process.argv[2];
  for (const c of CASES.filter((x) => !only || x.id === only)) {
    const f = await runGraphToEnd(c);
    console.log(`\n=== ${c.id} · ${c.label} (mode=${f.mode}) route=${f.route} risk=${f.riskRank?.level} valid=${f.validity?.valid}`);
    for (const t of f.trace) {
      console.log(`  ${String(t.seq).padStart(2)} ${t.agentLabel.padEnd(32)} ${t.stopTriggered ? "■" : "·"} ${t.summary.slice(0, 150)}`);
      for (const tc of t.toolCalls) console.log(`       ${tc.ok === false ? "✗" : "→"} ${tc.tool}(${tc.input.slice(0, 50)}) = ${tc.output.slice(0, 110)}`);
    }
    for (const fl of f.flags) console.log(`  [${fl.severity}] ${fl.code}: ${fl.message.slice(0, 140)}`);
    if (f.narrative) console.log(`  NARRATIVE (${f.narrativeCheck?.checkedText}, ${f.narrativeCheck?.claimsChecked} claims): ${f.narrative}`);
    if (f.haltReason) console.log(`  HALT: ${f.haltReason}`);
    if (f.clock) console.log(`  CLOCK: ${f.clock.rule} due=${f.clock.due}`);
  }
})();
