import Link from "next/link";
import "./site.css";

export default function Landing() {
  return (
    <>
      <nav className="nav">
        <div className="nav-in">
          <div className="logo">SURE</div>
          <div className="wordmark">
            SURE<span>Safety Understanding, Risk &amp; Evidence</span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
            <a className="lnk" href="#problem">Problem</a>
            <a className="lnk" href="#how">How it works</a>
            <a className="lnk" href="#agents">Agents</a>
            <a className="lnk" href="#evidence">Evidence</a>
            <Link className="cta" href="/demo" style={{ marginLeft: 20 }}>Launch the demo</Link>
          </div>
        </div>
      </nav>

      {/* ---------------- HERO ---------------- */}
      <header className="hero">
        <div className="site">
          <div className="eyebrow">ABHIKALP 2026 · Case 6 · Healthcare &amp; Pharmaceuticals</div>
          <h1>
            Every fact in a safety report, <em>traceable to the page it came from.</em>
          </h1>
          <p className="lede">
            SURE is an agentic workflow layer for pharmacovigilance case processing. Eight bounded
            agents assemble an ICSR from fragmented source documents — and stop, visibly, wherever
            the evidence runs out. A qualified reviewer still signs every case.
          </p>
          <div className="btns">
            <Link className="cta lg" href="/demo">Launch the working demo →</Link>
            <a className="cta lg ghost" href="#how">See how it works</a>
          </div>
          <p className="micro">
            Three synthetic cases. One of them SURE refuses to draft — that is the one to watch.
          </p>

          <div className="stats">
            <div className="stat-c">
              <div className="n">300+ hrs</div>
              <div className="l">Manual AE review, MedDRA coding &amp; synthesis per trial phase</div>
              <div className="s">ABHIKALP 2026 case brief</div>
            </div>
            <div className="stat-c">
              <div className="n">~2 Mn / yr</div>
              <div className="l">AE, use-error &amp; product-complaint reports reaching the US FDA</div>
              <div className="s">Oracle Health Sciences · ~40% serious</div>
            </div>
            <div className="stat-c">
              <div className="n">$10.4 → $22.3B</div>
              <div className="l">Global pharmacovigilance market, 2025 → 2034 · 8.88% CAGR</div>
              <div className="s">Precedence Research, 2025</div>
            </div>
            <div className="stat-c">
              <div className="n">10.9%</div>
              <div className="l">APAC CAGR — fastest-growing region; India a primary PV outsourcing hub</div>
              <div className="s">PvPI launched indigenous ADRMS, Aug 2024</div>
            </div>
          </div>
        </div>
      </header>

      {/* ---------------- PROBLEM ---------------- */}
      <section className="band" id="problem">
        <div className="site">
          <div className="kicker">The problem</div>
          <h2 className="sec">
            Safety teams don’t spend their time writing. They spend it <em>reassembling a case from
            documents that don’t agree.</em>
          </h2>
          <p className="sec">
            One ICSR arrives as a physician note, a patient diary and a lab PDF — with no
            machine-readable link between them. Five of the eight stages below are clerical
            reconstruction. Only the last three are safety judgement.
          </p>

          <div className="chain">
            {[
              ["01", "Collect", "Evidence scattered across notes, diaries, lab PDFs, forms and email"],
              ["02", "Extract", "Dates, products, doses and lab values buried in free text"],
              ["03", "Reconcile", "Synonyms, duplicates, inconsistent dates, incomplete history"],
              ["04", "Interpret", "Suspected product unclear; confounders unresolved"],
              ["05", "Code", "MedDRA term choice varies by reviewer and dictionary version"],
            ].map(([i, t, d]) => (
              <div className="ch" key={i}>
                <span className="i">{i}</span>
                <div className="t">{t}</div>
                <div className="d">{d}</div>
              </div>
            ))}
            {[
              ["06", "Assess", "Seriousness needs expert review — queues run FIFO, not by risk"],
              ["07", "Draft", "Approved facts re-typed again into E2B(R3) fields"],
              ["08", "Review", "Reviewer retraces every fact to its source before sign-off"],
            ].map(([i, t, d]) => (
              <div className="ch j" key={i}>
                <span className="i">{i}</span>
                <div className="t">{t}</div>
                <div className="d">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- HOW ---------------- */}
      <section className="band alt" id="how">
        <div className="site">
          <div className="kicker">How it works</div>
          <h2 className="sec">
            One case, five agentic steps — and a human gate that <em>cannot be skipped.</em>
          </h2>
          <p className="sec">
            The path through the graph depends on the state of the case. An unresolved critical
            conflict means the drafting agent is never reached at all.
          </p>

          <div className="steps">
            {[
              ["01", "Ingest", "Case bundle imported. Source, timestamp, file identity and permissions recorded before anything is read.", "document inventory"],
              ["02", "Extract & link", "Fields pulled with the exact source span kept. Every citation verified against the real page text.", "facts + source spans"],
              ["03", "Reconcile", "Timeline and drug–event graph built. Contradictions surfaced, never guessed at.", "graph + open questions"],
              ["04", "Rank & draft", "Queue ranked with stated reasons. Narrative written only from sourced facts.", "validated draft"],
            ].map(([i, t, d, o]) => (
              <div className="st" key={i}>
                <div className="h"><i>{i}</i>{t}</div>
                <div className="b"><p>{d}</p><div className="out">Hands off → {o}</div></div>
              </div>
            ))}
            <div className="st stop">
              <div className="h"><i>05</i>Human approve</div>
              <div className="b">
                <p>A qualified reviewer inspects each source, corrects, or leaves a field unknown. Every edit is versioned.</p>
                <div className="out">SURE never submits to a regulator</div>
              </div>
            </div>
          </div>

          <div className="cards">
            <div className="card key">
              <span className="tag">The control that matters</span>
              <h3>Citations are verified, not trusted</h3>
              <p>
                Every quoted span is checked against the page it claims to come from. A field whose
                citation fails verification has its value <b>thrown away</b> and is downgraded to a
                gap. That is the mechanism behind traceability — a mechanical check, not a prompt
                instruction.
              </p>
            </div>
            <div className="card">
              <span className="tag">Gaps stay visible</span>
              <h3>Unknown stays unknown</h3>
              <p>
                No value is ever invented to make a form look complete. Missing and contradictory
                fields are recorded in a gap ledger, and a follow-up query is drafted — drafted,
                never answered.
              </p>
            </div>
            <div className="card">
              <span className="tag">Bounded authority</span>
              <h3>Agentic in workflow, not in judgement</h3>
              <p>
                SURE coordinates extraction, reconciliation, validation and drafting. It does not
                decide causality, does not decide seriousness, and cannot submit anything anywhere.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- AGENTS ---------------- */}
      <section className="band" id="agents">
        <div className="site">
          <div className="kicker">Agentic architecture</div>
          <h2 className="sec">Eight agents. Each one with a <em>hard stop.</em></h2>
          <p className="sec">
            Every boundary below is enforced in code and surfaced in the live trace on each run.
          </p>

          <table className="ag">
            <thead><tr><th>Agent</th><th>What it is permitted to do</th><th>Where it must stop</th></tr></thead>
            <tbody>
              {[
                ["Intake & classification", "Identifies file types, splits bundles, flags unreadable pages", "Draws no clinical inference at intake"],
                ["Evidence extraction", "Pulls fields, dates, products, doses and outcomes with source spans", "Preserves original text and units; an unverifiable citation is discarded"],
                ["Terminology mapping", "Proposes MedDRA and product codes, version recorded", "Cannot overwrite source wording; a human confirms every code"],
                ["Evidence graph", "Links timeline, medication history and lab findings; marks conflicts", "Labels links documented / candidate / unresolved — never causal"],
                ["Risk prioritisation", "Ranks the review queue and states the reason for each rank", "Cannot suppress a case subject to mandatory review"],
                ["Completeness check", "Validates required fields, date order, units, duplicates", "Unknown stays unknown — no value invented to pass a check"],
                ["Narrative drafting", "Assembles the narrative and structured fields from approved facts", "No unsupported claim; halts on a critical conflict; cannot submit"],
              ].map(([n, d, s]) => (
                <tr key={n}><td className="nm">{n}</td><td>{d}</td><td className="stop">{s}</td></tr>
              ))}
              <tr className="human">
                <td className="nm">Qualified reviewer</td>
                <td>Confirms, corrects, rejects, requests follow-up, approves</td>
                <td className="stop">Final clinical and regulatory judgement remains human-owned</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------- EVIDENCE ---------------- */}
      <section className="band alt" id="evidence">
        <div className="site">
          <div className="kicker">Research grounding</div>
          <h2 className="sec">
            Components proven separately. <em>The chain is what we still have to prove.</em>
          </h2>
          <p className="sec">
            SURE is built on published work — and on an honest reading of what that work does and
            does not establish. These are each study’s results in each study’s setting. None of them
            is SURE’s performance.
          </p>

          <div className="ev">
            {[
              ["44.4–95.8%", "PPV range across four monitored ADE types, 10 institutions", "Chen et al., 2020", "Take: configurable rule triggers, each alert carrying its reason. Refuse: treating an alert as a confirmed ADR."],
              ["91.1 → 86.3", "F1 in-house vs external site — deep learning + drug knowledge graph", "Feng et al., 2023", "Take: graph linking of drug–event pairs. Refuse: assuming performance transfers between sites."],
              ["AUC 0.707", "Severe-ADR prediction · 508 SADRs · dual-centre cohort", "Bu et al., 2025", "Take: a transparent risk score as a queue aid. Refuse: moderate discrimination posing as judgement."],
              ["160 vs 50", "ADRs found by active monitoring vs spontaneous reporting · 4.2 vs 10.7 days", "Jing et al., 2026", "Take: active monitoring as a later phase. Refuse: assuming hospital integration in the MVP."],
            ].map(([n, w, p, t]) => (
              <div className="evc" key={p}>
                <div className="n">{n}</div>
                <div className="w">{w}</div>
                <div className="p">{p}</div>
                <div className="t">{t}</div>
              </div>
            ))}
          </div>

          <div className="honest">
            <h3>What SURE does not do</h3>
            <ul>
              <li>Decide whether a drug caused an event</li>
              <li>Decide seriousness or severity</li>
              <li>Submit anything to a regulator</li>
              <li>Fill a missing field with a plausible value</li>
              <li className="do">Links every material field to its source passage</li>
              <li className="do">Keeps every gap and contradiction visible</li>
              <li className="do">Versions every reviewer correction</li>
              <li className="do">Halts and escalates when evidence conflicts</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ---------------- RESULTS ---------------- */}
      <section className="band">
        <div className="site">
          <div className="kicker">Measured, not asserted</div>
          <h2 className="sec">Current results on <em>three synthetic cases.</em></h2>
          <p className="sec">
            Run the evaluation harness yourself with <code>python3 eval/run_eval.py</code>. The
            extractor was developed against these same three cases, so critical-field accuracy here
            is a tuned result, not a validated one — held-out evaluation is the Week 6–7 pilot gate.
          </p>
          <div className="results">
            <div className="res"><div className="n">15/15</div><div className="l">Critical fields correct</div></div>
            <div className="res"><div className="n">0 / 22</div><div className="l">Unsupported claims among asserted values</div></div>
            <div className="res"><div className="n">5 / 7</div><div className="l">Gaps correctly identified</div></div>
            <div className="res"><div className="n">3 / 3</div><div className="l">Escalation decisions correct</div></div>
          </div>
          <div style={{ marginTop: 30 }}>
            <Link className="cta lg" href="/demo">Try it on the three cases →</Link>
          </div>
        </div>
      </section>

      <footer className="foot">
        <div className="site">
          <div className="warn">
            All case data is synthetic and fabricated for demonstration. No real patient data is
            used anywhere in this product. Not for clinical or regulatory use.
          </div>
          <p>
            <b>SURE — Safety Understanding, Risk &amp; Evidence.</b> Built for ABHIKALP 2026,
            Case 6: Healthcare &amp; Pharmaceuticals.
          </p>
          <p style={{ marginTop: 6 }}>
            <b>Team Product Avengers</b> — Vaishnavi Tyagi · Gautam Jharwal · Sanhita Mahtre · Tanmya Pol
          </p>
          <p style={{ marginTop: 14, fontSize: 11 }}>
            70% drafting-time reduction and 100% clinical data accuracy are targets stated in the
            case brief. They are not results demonstrated by this prototype.
          </p>
        </div>
      </footer>
    </>
  );
}
