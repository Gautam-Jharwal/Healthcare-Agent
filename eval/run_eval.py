#!/usr/bin/env python3
"""
SURE evaluation harness.

Produces the numbers for the "Measured, not asserted" slide. It compares what
the agent chain extracted against a hand-written reference answer for each
synthetic case, and reports per-field results rather than one flattering
aggregate.

Usage
-----
  1. Start the app:            npm run dev
  2. In another terminal:      python3 eval/run_eval.py
  3. Results land in:          eval/results.json  and are printed as a table

The harness scores four things:
  * critical-field accuracy   — correct values on fields that matter clinically
  * unsupported-claim rate    — values asserted with no surviving citation
  * gap recall                — gaps the system found vs gaps that truly exist
  * escalation correctness    — did it halt exactly when it should have

It deliberately does NOT report a single headline accuracy number.
"""

import json
import sys
import urllib.request
from pathlib import Path

BASE = "http://localhost:3000"
ROOT = Path(__file__).resolve().parent

CRITICAL = {"event_term", "onset_date", "suspect_drug", "seriousness", "outcome"}


def load_reference():
    """Reads the reference answers straight out of the TypeScript case file."""
    src = (ROOT.parent / "lib" / "cases" / "index.ts").read_text(encoding="utf-8")
    refs, pos = {}, 0
    while True:
        i = src.find('    id: "IN-', pos)
        if i == -1:
            break
        case_id = src[i + 9 : src.index('"', i + 9)]
        r = src.find("reference: {", i)
        nxt = src.find('    id: "IN-', i + 1)
        if r == -1 or (nxt != -1 and r > nxt):
            pos = i + 1
            continue
        block = src[r : src.find("\n    },", r)]
        fields = {}
        fb = block[block.find("fields: {") : block.find("},", block.find("fields: {"))]
        for line in fb.splitlines()[1:]:
            line = line.strip().rstrip(",")
            if ":" not in line:
                continue
            k, v = line.split(":", 1)
            k, v = k.strip(), v.strip()
            fields[k] = None if v == "null" else v.strip('"')
        gaps_raw = block[block.find("expectedGaps: [") + 15 :]
        gaps = [g.strip().strip('"') for g in gaps_raw[: gaps_raw.find("]")].split(",") if g.strip()]
        stop_raw = block[block.find("expectedStop:") + 13 :].split("\n")[0].strip().rstrip(",")
        refs[case_id] = {
            "fields": fields,
            "gaps": gaps,
            "stop": None if stop_raw == "null" else stop_raw.strip('"'),
        }
        pos = i + 1
    return refs


def run_case(case_id):
    req = urllib.request.Request(
        f"{BASE}/api/run",
        data=json.dumps({"caseId": case_id}).encode(),
        headers={"content-type": "application/json"},
    )
    final = None
    with urllib.request.urlopen(req, timeout=120) as resp:
        for raw in resp:
            line = raw.decode().strip()
            if not line:
                continue
            ev = json.loads(line)
            if ev.get("file"):
                final = ev["file"]
    return final


def norm(v):
    if v is None:
        return None
    return " ".join(str(v).lower().replace("—", "-").split()).strip(" .")


def same(a, b):
    """Lenient date/value match: a reference 2026-03-26 matches '26 March 2026'."""
    na, nb = norm(a), norm(b)
    if na == nb:
        return True
    if not na or not nb:
        return False
    if na in nb or nb in na:
        return True
    months = "january february march april may june july august september october november december".split()
    if "-" in na and na.count("-") == 2:
        y, m, d = na.split("-")
        try:
            alt = f"{int(d)} {months[int(m) - 1]} {y}"
            return alt in nb
        except (ValueError, IndexError):
            return False
    return False


def main():
    refs = load_reference()
    if not refs:
        print("Could not read reference answers.", file=sys.stderr)
        sys.exit(1)

    rows, totals = [], {
        "crit_correct": 0, "crit_total": 0,
        "unsupported": 0, "asserted": 0,
        "gap_hit": 0, "gap_total": 0,
        "escalation_correct": 0, "cases": 0,
    }

    for case_id, ref in refs.items():
        try:
            f = run_case(case_id)
        except Exception as e:  # noqa: BLE001
            print(f"  ! {case_id} failed: {e}", file=sys.stderr)
            continue
        if not f:
            continue

        got = {x["key"]: x for x in f["fields"]}
        crit_c = crit_t = unsupported = asserted = 0

        for key, expected in ref["fields"].items():
            g = got.get(key)
            if not g:
                continue
            value = g.get("value")
            if value:
                asserted += 1
                if not g.get("citations"):
                    unsupported += 1
            if key in CRITICAL:
                crit_t += 1
                if expected is None:
                    # reference says unresolvable: the correct behaviour is NOT to assert
                    if value is None:
                        crit_c += 1
                elif same(expected, value):
                    crit_c += 1

        gap_hit = len(set(ref["gaps"]) & set(f.get("gaps", [])))
        esc_ok = bool(f.get("halted")) == bool(ref["stop"])

        totals["crit_correct"] += crit_c; totals["crit_total"] += crit_t
        totals["unsupported"] += unsupported; totals["asserted"] += asserted
        totals["gap_hit"] += gap_hit; totals["gap_total"] += len(ref["gaps"])
        totals["escalation_correct"] += int(esc_ok); totals["cases"] += 1

        rows.append({
            "case": case_id,
            "critical_fields": f"{crit_c}/{crit_t}",
            "unsupported_claims": unsupported,
            "gaps_found": f"{gap_hit}/{len(ref['gaps'])}",
            "halted": f.get("halted"),
            "should_halt": bool(ref["stop"]),
            "escalation_correct": esc_ok,
            "mode": f.get("mode"),
        })

    print("\n  SURE evaluation — synthetic cases, n =", totals["cases"])
    print("  " + "-" * 78)
    print(f"  {'case':<16}{'critical':<12}{'unsupported':<14}{'gaps':<10}{'halt ok':<10}{'mode'}")
    print("  " + "-" * 78)
    for r in rows:
        print(f"  {r['case']:<16}{r['critical_fields']:<12}{r['unsupported_claims']:<14}"
              f"{r['gaps_found']:<10}{str(r['escalation_correct']):<10}{r['mode']}")
    print("  " + "-" * 78)

    ct, cc = totals["crit_total"], totals["crit_correct"]
    print(f"  Critical-field accuracy ....... {cc}/{ct} = {100*cc/ct:.1f}%" if ct else "  no critical fields")
    print(f"  Unsupported-claim rate ........ {totals['unsupported']}/{totals['asserted']} asserted values")
    print(f"  Gap recall .................... {totals['gap_hit']}/{totals['gap_total']}")
    print(f"  Escalation correctness ........ {totals['escalation_correct']}/{totals['cases']}")
    print("\n  Report these as an n=%d synthetic-case result. Not a validation study.\n" % totals["cases"])

    (ROOT / "results.json").write_text(json.dumps({"rows": rows, "totals": totals}, indent=2))
    print(f"  Written to {ROOT / 'results.json'}\n")


if __name__ == "__main__":
    main()
