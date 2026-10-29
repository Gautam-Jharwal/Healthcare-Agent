"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Health = { provider: string | null; ok: boolean | null; model?: string | null; chain?: string[]; error?: string };

export type RunMode = { mode: "live" | "degraded" | "seeded" | "mock"; model: string | null } | null;

export default function Header({ current, runMode }: { current: "home" | "overview" | "demo" | "eval" | "study"; runMode?: RunMode }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [theme, setTheme] = useState<string | null>(null);

  useEffect(() => {
    try { setTheme(document.documentElement.dataset.theme ?? null); } catch {}
    fetch("/api/health?ping=1")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ provider: null, ok: false, error: "unreachable" }));
  }, []);

  function toggleTheme() {
    const dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try { localStorage.setItem("sure-theme", next); } catch {}
  }

  let mode: string = "seeded";
  let label = "Checking the model…";
  if (runMode) {
    mode = runMode.mode;
    label =
      runMode.mode === "live" ? `Gemini live: ${runMode.model}` :
      runMode.mode === "degraded" ? "Last run degraded: some agents fell back to rules" :
      runMode.mode === "mock" ? "Mock model (test only)" : "Last run: rules only (no model key)";
  } else if (health) {
    if (!health.provider) { mode = "seeded"; label = "Seeded mode: rules only, no model key set"; }
    else if (health.provider === "mock") { mode = "mock"; label = "Mock model (test only)"; }
    else if (health.ok) { mode = "live"; label = `Gemini live: ${health.model}`; }
    else if (health.ok === false) { mode = "degraded"; label = `Model unreachable (${health.error ?? "error"}); rules will run`; }
    else { mode = "seeded"; label = `Model configured: ${health.provider}`; }
  }

  const nav: [string, string, typeof current][] = [
    ["/", "Home", "home"],
    ["/overview", "Overview", "overview"],
    ["/demo", "Analysis", "demo"],
    ["/eval", "Evaluation", "eval"],
  ];

  return (
    <header className="top">
      <Link href="/" className="mark" aria-label="SURE home">
        <b>SURE</b>
        <span>Safety Understanding, Risk &amp; Evidence</span>
      </Link>
      <nav className="nav" aria-label="Main">
        {nav.map(([href, text, key]) => (
          <Link key={href} href={href} aria-current={current === key ? "page" : undefined}>{text}</Link>
        ))}
      </nav>
      <div className="spacer" />
      {mode === "live" && (
        <span className="mode" data-mode={mode} title="Shows the model that answered. Live is only claimed when every model call succeeded.">
          <i aria-hidden /> <span className="mode-text">{label}</span>
        </span>
      )}
      <button className="theme-btn" onClick={toggleTheme} aria-label="Switch light or dark theme" title="Switch theme">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      </button>
    </header>
  );
}
