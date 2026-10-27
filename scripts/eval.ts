/**
 * Runs every case with a reference answer through the agent graph and prints
 * per-field results. No server needed:  npx tsx scripts/eval.ts
 * Set GEMINI_API_KEY (or another key) to evaluate live mode.
 */
import { CASES } from "../lib/cases";
import { runGraphToEnd } from "../lib/engine/graph";
import { scoreCase, totals, type CaseScore } from "../lib/engine/score";
import { writeFileSync } from "node:fs";

(async () => {
  const scores: CaseScore[] = [];
  for (const c of CASES.filter((x) => x.reference)) {
    const t0 = Date.now();
    const f = await runGraphToEnd(c);
    const s = scoreCase(c, f, Date.now() - t0)!;
    scores.push(s);
    const wrong = s.fields.filter((x) => !x.correct);
    console.log(
      `${s.set.padEnd(7)} ${s.caseId.padEnd(18)} fields ${String(s.allCorrect).padStart(2)}/${s.allTotal}  gaps ${s.gapHits}/${s.gapExpected}${s.gapFalse ? ` (+${s.gapFalse} extra)` : ""}  route ${s.route}${s.routeOk ? "" : ` ✗ want ${s.expectedRoute}`}  risk ${s.risk}${s.riskOk ? "" : ` ✗ want ${s.expectedRisk}`}  valid ${s.validOk ? "ok" : "✗"}  flags ${s.flagsExpected.filter((x) => s.flagsFound.includes(x)).length}/${s.flagsExpected.length}  mode ${s.mode}`,
    );
    for (const w of wrong) console.log(`        ✗ ${w.key}: expected ${JSON.stringify(w.expected)} got ${JSON.stringify(w.got)} [${w.status}]`);
    for (const fl of s.flagsExpected.filter((x) => !s.flagsFound.includes(x))) console.log(`        ✗ missing flag ${fl}`);
  }
  for (const set of ["core", "stress", "heldout"]) {
    const ss = scores.filter((s) => s.set === set);
    if (!ss.length) continue;
    const t = totals(ss);
    console.log(`\n${set.toUpperCase()} (n=${t.cases})  all fields ${t.allCorrect}/${t.allTotal}  critical ${t.critCorrect}/${t.critTotal}  gap recall ${t.gapHits}/${t.gapExpected} (false gaps ${t.gapFalse})  routing ${t.routeOk}/${t.cases}  risk ${t.riskOk}/${t.cases}  validity ${t.validOk}/${t.cases}  flags ${t.flagsHit}/${t.flagsExpected}  unsupported ${t.unsupported}/${t.asserted}`);
  }
  writeFileSync("eval/results.json", JSON.stringify({ at: new Date().toISOString(), scores, totals: totals(scores) }, null, 2));
})();
