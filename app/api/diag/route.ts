/**
 * Diagnostic endpoint — open /api/diag in a browser.
 *
 * Tells you whether the configured model provider actually works, and if not,
 * returns the real error instead of silently falling back. Safe to leave
 * deployed: the API key is never returned, only a masked preview.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

function mask(key?: string) {
  if (!key) return null;
  return `${key.slice(0, 6)}…${key.slice(-4)} (${key.length} chars)`;
}

/** Never let a key leak through an error message or echoed URL. */
function scrub(text: string, ...secrets: (string | undefined)[]) {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("***REDACTED***");
  return out.slice(0, 1200);
}

export async function GET() {
  const gem = process.env.GEMINI_API_KEY;
  const oai = process.env.OPENAI_API_KEY;
  const ant = process.env.ANTHROPIC_API_KEY;

  const provider = oai ? "openai" : ant ? "anthropic" : gem ? "gemini" : null;
  const model =
    provider === "openai"
      ? process.env.SURE_OPENAI_MODEL ?? "gpt-4o-mini"
      : provider === "anthropic"
      ? process.env.SURE_ANTHROPIC_MODEL ?? "claude-haiku-4-5"
      : provider === "gemini"
      ? process.env.SURE_GEMINI_MODEL ?? "gemini-2.0-flash"
      : null;

  const report: Record<string, unknown> = {
    verdict: "checking…",
    provider,
    model,
    keys: {
      GEMINI_API_KEY: mask(gem),
      OPENAI_API_KEY: mask(oai),
      ANTHROPIC_API_KEY: mask(ant),
    },
    keyHasWhitespace: gem ? gem !== gem.trim() : null,
  };

  if (!provider) {
    report.verdict = "NO KEY SET — app will run in seeded mode.";
    return Response.json(report, { status: 200 });
  }

  /* ---------- Gemini: list the models this key can actually use ---------- */
  if (provider === "gemini") {
    const key = (gem as string).trim();
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      const body = await r.text();
      if (!r.ok) {
        report.listModels = { ok: false, status: r.status, error: scrub(body, key, gem) };
      } else {
        const data = JSON.parse(body);
        const usable = (data.models ?? [])
          .filter((m: { supportedGenerationMethods?: string[] }) =>
            m.supportedGenerationMethods?.includes("generateContent")
          )
          .map((m: { name: string }) => m.name.replace(/^models\//, ""));
        report.listModels = { ok: true, count: usable.length, usableModels: usable };
      }
    } catch (e) {
      report.listModels = { ok: false, error: scrub(String(e), key, gem) };
    }
  }

  /* ---------- try one real generation call ---------- */
  try {
    let status = 0;
    let body = "";

    if (provider === "gemini") {
      const key = (gem as string).trim();
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: "Reply with JSON only." }] },
            contents: [{ role: "user", parts: [{ text: 'Return {"ok":true}' }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 40, responseMimeType: "application/json" },
          }),
        }
      );
      status = r.status;
      body = scrub(await r.text(), key, gem);
    } else if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${(oai as string).trim()}` },
        body: JSON.stringify({
          model,
          max_tokens: 40,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: 'Return {"ok":true}' }],
        }),
      });
      status = r.status;
      body = scrub(await r.text(), oai);
    } else {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": (ant as string).trim(),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 40,
          messages: [{ role: "user", content: 'Return {"ok":true} and nothing else.' }],
        }),
      });
      status = r.status;
      body = scrub(await r.text(), ant);
    }

    report.testCall = { ok: status === 200, status, response: body };

    if (status === 200) {
      report.verdict = `WORKING — ${provider} / ${model} responded. The app will run in live mode.`;
    } else if (status === 404) {
      report.verdict =
        `MODEL NOT FOUND (404). "${model}" is not available to this key. ` +
        `Pick one from listModels.usableModels below, add a Vercel variable ` +
        `SURE_GEMINI_MODEL with that name, and redeploy.`;
    } else if (status === 400) {
      report.verdict = `BAD REQUEST (400). Usually an invalid or malformed API key. See response below.`;
    } else if (status === 401 || status === 403) {
      report.verdict = `KEY REJECTED (${status}). The key is wrong, revoked, or the API is not enabled for this project.`;
    } else if (status === 429) {
      report.verdict = `RATE LIMITED (429). Free-tier quota hit. Wait a minute and reload this page.`;
    } else {
      report.verdict = `FAILED (${status}). See response below.`;
    }
  } catch (e) {
    report.testCall = { ok: false, error: scrub(String(e), gem, oai, ant) };
    report.verdict = "NETWORK ERROR calling the provider. See error below.";
  }

  return Response.json(report, { status: 200 });
}
