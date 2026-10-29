import Link from "next/link";
import Header from "@/components/Header";
import "./site.css";

/**
 * The first screen a safety officer sees.
 *
 * Deliberately almost empty: one action. The architecture, the controls and
 * the evaluation live one click away under Overview, for the reader who wants
 * them. Someone who came here to process a case should not have to scroll
 * past an explanation of the agent graph to find the button.
 */
export default function Home() {
  return (
    <>
      <Header current="home" />
      <main className="home">
        <div className="home-in">
          <p className="home-kicker">Pharmacovigilance case processing</p>

          <h1 className="home-h1">
            Turn case documents into a<br />
            reviewable safety report.
          </h1>

          <p className="home-sub">
            Upload the physician note, patient diary and lab report. SURE assembles the
            Individual Case Safety Report, cites every fact to the page it came from, and
            stops where the evidence runs out.
          </p>

          <div className="home-cta">
            <Link className="btn primary home-btn" href="/demo">
              Start a case review
            </Link>
            <Link className="home-link" href="/overview">
              How it works →
            </Link>
          </div>

          <ul className="home-points">
            <li>
              <strong>Every fact is cited.</strong> A value whose quote cannot be found on the
              page it names is discarded, not shown.
            </li>
            <li>
              <strong>It stops rather than guesses.</strong> Conflicting sources halt the draft
              and raise the case for adjudication.
            </li>
            <li>
              <strong>A named reviewer signs off.</strong> Nothing is exported, and nothing
              reaches a regulator, without human approval.
            </li>
          </ul>

          
        </div>
      </main>
    </>
  );
}
