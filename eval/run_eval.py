#!/usr/bin/env python3
"""
SURE evaluation harness (Python).

Calls the running app's /api/eval endpoint, which runs every case that has a
reference answer through the full agent graph and scores all 14 fields.

  1. Start the app:          npm run dev        (or use the deployed URL)
  2. Run:                    python3 eval/run_eval.py [base_url] [--live]
  3. Results are printed and written to eval/results.json

--live uses the configured model on the three demo cases (needs an API key on
the server). Without it, the rule-based path is evaluated on every case.

The same scoring runs without a server:  npx tsx scripts/eval.ts
"""

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    base = (args[0] if args else "http://localhost:3000").rstrip("/")
    live = "--live" in sys.argv
    url = f"{base}/api/eval?fresh=1{'&live=1' if live else ''}"
    with urllib.request.urlopen(url, timeout=120) as resp:
        data = json.load(resp)
    if "error" in data:
        print("Error:", data["error"], file=sys.stderr)
        sys.exit(1)

    print(f"\n  SURE evaluation — {base} — {'model reader' if data.get('live') else 'rules only'}")
    print("  " + "-" * 100)
    print(f"  {'set':<8}{'case':<20}{'fields':<9}{'critical':<10}{'gaps':<10}{'route':<12}{'priority':<12}{'valid':<7}{'flags'}")
    print("  " + "-" * 100)
    for s in data["scores"]:
        flags = f"{len([f for f in s['flagsExpected'] if f in s['flagsFound']])}/{len(s['flagsExpected'])}"
        print(
            f"  {s['set']:<8}{s['caseId']:<20}{s['allCorrect']}/{s['allTotal']:<6}{s['critCorrect']}/{s['critTotal']:<7}"
            f"{s['gapHits']}/{s['gapExpected']:<7}{(s['route'] or '') + ('' if s['routeOk'] else ' ✗'):<12}"
            f"{(s['risk'] or '') + ('' if s['riskOk'] else ' ✗'):<12}{'ok' if s['validOk'] else '✗':<7}{flags}"
        )
        for f in s["fields"]:
            if not f["correct"]:
                print(f"        ✗ {f['key']}: expected {json.dumps(f['expected'])} got {json.dumps(f['got'])} [{f['status']}]")
    print("  " + "-" * 100)
    for name, t in data["bySet"].items():
        if not t["cases"]:
            continue
        print(
            f"  {name.upper():<8} n={t['cases']}  all fields {t['allCorrect']}/{t['allTotal']}  critical {t['critCorrect']}/{t['critTotal']}  "
            f"gap recall {t['gapHits']}/{t['gapExpected']} (false {t['gapFalse']})  routing {t['routeOk']}/{t['cases']}  "
            f"unsupported {t['unsupported']}/{t['asserted']}"
        )
    print("\n  Core and stress cases are author-tuned. Only the held-out set measures accuracy.\n")
    (ROOT / "results.json").write_text(json.dumps(data, indent=2))
    print(f"  Written to {ROOT / 'results.json'}\n")


if __name__ == "__main__":
    main()
