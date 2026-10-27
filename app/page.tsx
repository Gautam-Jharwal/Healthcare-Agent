import Link from "next/link";
import Header from "@/components/Header";
import { CASES } from "@/lib/cases";
import { runGraphToEnd } from "@/lib/engine/graph";
import "./site.css";

/**
 * The hospital-side home screen: a drug-safety officer's work queue.
 *
 * Not a landing page. Someone who opens this already knows what the product
 * is; what they need is which case is closest to its reporting deadline. The
 * explanation of how any of it works lives under Overview.
 *
 * Every number here comes from a real run of the agent graph at build time
 * (rules only, no model) — the route and the reporting clock are computed,
 * not written by hand.
 */

const ROUTE_LABEL: Record<string, string> = {
  draft: "Ready for review",
  escalate: "Needs adjudication",
  hold: "Awaiting information",
};

interface Row {
  id: string;
  label: string;
  level: "routine" | "expedited" | "urgent";
  route: string;
  days: number | null;
  due: string | null;
  rule: string;
}

async function queue(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const c of CASES) {
    const f = await runGraphToEnd(c, {}, { seeded: true });
    rows.push({
      id: c.id,
      label: c.label,
      level: f.riskRank?.level ?? "routine",
      route: f.route ?? "hold",
      days: f.clock?.days ?? null,
      due: f.clock?.due ?? null,
      rule: f.clock?.rule ?? "",
    });
  }
  const rank = { urgent: 0, expedited: 1, routine: 2 };
  return rows.sort((a, b) => {
    if (rank[a.level] !== rank[b.level]) return rank[a.level] - rank[b.level];
    if (a.days === null) return 1;
    if (b.days === null) return -1;
    return a.days - b.days;
  });
}

function shortDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default async function Home() {
  const rows = await queue();
  const expedited = rows.filter((r) => r.level !== "routine").length;
  const adjudication = rows.filter((r) => r.route === "escalate").length;
  const next = rows[0];
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <>
      <Header current="home" />
      <main className="queue-page">
        <div className="queue-wrap">
          <div className="queue-top">
            <h1>Case queue</h1>
            <p className="queue-date">{today}</p>
          </div>

          <div className="queue-counts">
            <div>
              <span className="qc-n">{rows.length}</span>
              <span className="qc-l">open</span>
            </div>
            <div className={expedited ? "urgent" : ""}>
              <span className="qc-n">{expedited}</span>
              <span className="qc-l">on an expedited clock</span>
            </div>
            <div>
              <span className="qc-n">{adjudication}</span>
              <span className="qc-l">need adjudication</span>
            </div>
          </div>

          <ol className="queue-list">
            {rows.map((r) => (
              <li key={r.id} className={r.level === "urgent" ? "hot" : r.level === "expedited" ? "warm" : ""}>
                <Link href="/demo" className="qrow">
                  <span className="q-id">{r.id}</span>
                  <span className="q-main">
                    <span className="q-label">{r.label}</span>
                    <span className="q-route">{ROUTE_LABEL[r.route] ?? r.route}</span>
                  </span>
                  <span className="q-clock" title={r.rule}>
                    <span className={`q-due ${r.days === null ? "none" : ""}`}>
                      {r.due ? shortDate(r.due) : "No expedited clock"}
                    </span>
                    <span className="q-rule">
                      {r.days === null ? "Periodic reporting" : `${r.days}-day clock`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>

          <div className="queue-act">
            <Link className="btn primary queue-btn" href="/demo">
              Open {next?.id ?? "the next case"}
            </Link>
            <Link className="queue-help" href="/overview">
              How SURE processes a case
            </Link>
          </div>

          <p className="queue-foot">
            Every case here is synthetic, built for ABHIKALP 2026 by Team Product Avengers.
            Routes and reporting clocks are computed by the agent graph, not written by hand.
            Not for clinical or regulatory use.
          </p>
        </div>
      </main>
    </>
  );
}
