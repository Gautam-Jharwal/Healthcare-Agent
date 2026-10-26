# SURE — Safety Understanding, Risk & Evidence

Agentic ICSR case-processing MVP for ABHIKALP 2026, Case 6 (Healthcare & Pharmaceuticals).
Team: **Product Avengers** — Vaishnavi Tyagi · Gautam Jharwal · Sanhita Mahtre · Tanmya Pol

> All case data in this repository is **synthetic and fabricated**. No real patient
> data is present and none must ever be added. Not for clinical or regulatory use.

---

## 1. Deploy it (about 20 minutes, no command line needed)

### Step 1 — put the code on GitHub
1. Go to github.com → **New repository** → name it `sure-mvp` → Create.
2. On the empty repo page click **uploading an existing file**.
3. Drag in *every file and folder* from this project **except** `node_modules`.
4. Commit.

### Step 2 — get an API key (optional but recommended)
- OpenAI: platform.openai.com → API keys → create. **$5 of credit is far more than you need** — a case costs well under a cent.
- Or Anthropic: console.anthropic.com → API keys.

The app runs **without** a key in seeded mode, so do this second if you are short on time.

### Step 3 — deploy on Vercel
1. vercel.com → **Sign up with GitHub**.
2. **Add New → Project** → pick `sure-mvp` → Import.
3. Before clicking Deploy, open **Environment Variables** and add:
   - Name `OPENAI_API_KEY`, Value your key. *(or `ANTHROPIC_API_KEY`)*
4. **Deploy.** About 90 seconds later you have `https://sure-mvp-xxxx.vercel.app`.

That URL is your Round 2 MVP link. Every later push to GitHub redeploys automatically.

### Running it locally instead
```bash
npm install
cp .env.example .env.local      # paste your key in, or leave it empty
npm run dev                     # http://localhost:3000
```

---

## 2. What the judges will see

| Pane | What it shows |
|---|---|
| **Left** | Three case bundles — one clean, one with gaps, one that **halts**. Plus paste-your-own-text. Below, the source document with the cited passage highlighted. |
| **Centre** | The case file: every ICSR field with a `Sourced` / `Gap` / `Unknown` badge and its citation. Then the auto-drafted follow-up query, then the ICSR narrative. |
| **Right** | The live agent trace — each of the eight agents, its tool calls, its timing, and **the stop condition it checked**. Plus the routing decision and the human approval gate. |

**Demo in this order:**
1. `IN-2026-0392` — the happy path. 11/11 fields sourced, clean draft.
2. `IN-2026-0417` — two candidate suspect drugs. Watch it refuse to choose, record the gap, and draft a follow-up query instead of inventing an answer.
3. `IN-2026-0433` — **the one that matters.** Sources disagree on onset date and a lab page is unreadable. The routing decision flips to *escalate*, the drafting agent halts, and no narrative is produced.

Case 3 is the differentiator. Most teams will demo a happy path only.

---

## 3. How the agent actually works

```
intake → extract → terminology → evidenceGraph → risk → completeness
       ├─ [critical conflict open]  → escalate ─┐
       └─ [otherwise]               → draft   ──┤
                                                └→ humanGate  (always)
```

This is a **graph with conditional routing**, not a prompt chain. The path depends
on case state: an unresolved critical conflict means the drafting node is never
reached. See `lib/agents/graph.ts`.

Each of the eight nodes is bounded by a stop condition, defined in
`lib/agents/stopConditions.ts` and surfaced in the UI on every run:

| Agent | Hard boundary |
|---|---|
| Intake | No clinical inference at intake |
| Evidence extraction | Preserves original text and units; unverifiable citation is discarded |
| Terminology | Cannot overwrite source wording; human confirms every code |
| Evidence graph | Labels links documented / candidate / unresolved — never causal |
| Risk prioritisation | Cannot suppress a case subject to mandatory review |
| Completeness | Unknown stays unknown — no value invented to pass a check |
| Narrative drafting | No unsupported claim; halts on critical conflict; cannot submit |
| Qualified reviewer | Final clinical and regulatory judgement remains human-owned |

### The control worth demonstrating

`verifyCitation()` in `lib/agents/stopConditions.ts` checks that every quoted span
**actually appears on the page it claims to come from**. A field whose citation
fails verification is downgraded to a gap — the value is thrown away rather than
shown. That is what stops a fluent model attributing an invented value to a real
document, and it is the mechanism behind "every fact traceable to the page it came from".

---

## 4. Live mode vs seeded mode

| | Live | Seeded |
|---|---|---|
| Trigger | An API key is set | No key set, or the API call fails |
| Extraction | Model call with a strict schema, then citation verification | Rule-based parser over the same documents |
| Drafting | Model-written narrative from sourced facts only | Template narrative from the same facts |

Seeded mode is a genuine fallback, not a recording: it really parses the documents.
If the venue wifi dies during the finale, the demo still runs. The header badge
always tells you which mode you are in — **do not claim live results while the badge says seeded.**

---

## 5. Evaluation

```bash
npm run dev            # terminal 1
python3 eval/run_eval.py   # terminal 2
```

Current result on the three synthetic cases:

```
Critical-field accuracy ....... 15/15 = 100.0%
Unsupported-claim rate ........ 0/22 asserted values
Gap recall .................... 5/7
Escalation correctness ........ 3/3
```

**Read this honestly before you put it on a slide.** n=3 is tiny, and the rule-based
extractor was developed against these three cases, so 100% on critical fields is a
tuned result, not a validated one. Two defensible options:

- Report it as *"n=3 synthetic cases, extractor developed on the same set — held-out evaluation is the Week 6–7 gate"*, or
- Write 3–5 more cases that nobody tunes against and re-run. Gap recall of 5/7 is the kind of number that makes a jury trust the other ones.

---

## 6. Project structure

```
app/
  page.tsx              the dashboard
  api/run/route.ts      streams the agent run as NDJSON
  layout.tsx, globals.css
lib/
  cases/index.ts        3 synthetic bundles + reference answers + field spec
  agents/
    graph.ts            node wiring and the conditional edges
    agents.ts           the 8 nodes + the rule-based fallback extractor
    stopConditions.ts   stop conditions + citation verifier
    llm.ts              provider-agnostic model client (OpenAI or Anthropic)
    types.ts            CaseFile state and trace types
eval/run_eval.py        accuracy harness
scripts/smoke.ts        runs all 3 cases headlessly (npx tsx scripts/smoke.ts)
```

---

## 7. Deck corrections you now need to make

The Round 1 stack strip promised **Neo4j** and **Postgres + pgvector**. Neither is used.
The evidence graph is in-memory (`lib/agents/evidenceGraph` inside `agents.ts`), and there
is no database. Update the slide to:

> **Stack:** Next.js · TypeScript · OpenAI / Anthropic · Python (evaluation harness) · Vercel

Leaving the old strip up is the easiest point a judge can take off you in Q&A.

Also keep saying what the deck already says: **70% and 100% are the case brief's targets,
not SURE's results.** Nothing in this repository demonstrates either.
