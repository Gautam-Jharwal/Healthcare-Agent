/**
 * Provider-agnostic model client.
 *
 * Deliberately uses plain fetch rather than an SDK: fewer dependencies means
 * fewer ways for the Vercel build to fail the night before a deadline.
 *
 * Set ONE of these in your Vercel environment variables:
 *   OPENAI_API_KEY      -> uses gpt-4o-mini        (paid)
 *   ANTHROPIC_API_KEY   -> uses claude-haiku-4-5   (paid)
 *   GEMINI_API_KEY      -> uses gemini-flash-latest (Google AI Studio free tier)
 *
 * If more than one is set, the order above decides which wins.
 *
 * With neither set the app still runs: every agent falls back to its
 * deterministic path and the UI reports mode = "seeded".
 */

const OPENAI_MODEL = process.env.SURE_OPENAI_MODEL?.trim() ?? "gpt-4o-mini";
const ANTHROPIC_MODEL = process.env.SURE_ANTHROPIC_MODEL?.trim() ?? "claude-haiku-4-5";
const GEMINI_MODEL = process.env.SURE_GEMINI_MODEL?.trim() ?? "gemini-flash-latest";

export function activeProvider(): "openai" | "anthropic" | "gemini" | null {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

export function activeModelVersion(): string | null {
  const p = activeProvider();
  if (p === "openai") return OPENAI_MODEL;
  if (p === "anthropic") return ANTHROPIC_MODEL;
  if (p === "gemini") return lastGeminiModel ?? GEMINI_MODEL;
  return null;
}

export interface ModelCall {
  system: string;
  user: string;
  /** Maximum tokens for the reply. Kept small; these are extraction tasks. */
  maxTokens?: number;
}

/**
 * Fallback chain for Gemini. "gemini-flash-latest" is an alias pointing at the
 * newest flash model, which makes it the busiest endpoint on the free tier and
 * the one most likely to answer 503. The lite models carry far less traffic,
 * so when the primary stays busy we drop to those rather than giving up and
 * silently falling back to the deterministic path.
 */
const GEMINI_FALLBACKS = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];

function geminiChain(): string[] {
  return [...new Set([GEMINI_MODEL, ...GEMINI_FALLBACKS])];
}

/** The model that actually answered, which is not always the one configured. */
let lastGeminiModel: string | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Overload and rate-limit responses are worth retrying; the rest are not. */
function isTransient(status: number): boolean {
  return status === 429 || status === 500 || status === 503 || status === 504;
}

/**
 * Asks Gemini for JSON, retrying transient failures and walking down the model
 * chain. Bounded by a wall-clock deadline so it can never outlive the Vercel
 * function and turn a slow answer into no answer at all.
 */
async function geminiGenerate(
  call: ModelCall,
  maxTokens: number
): Promise<{ raw: string; model: string }> {
  const key = process.env.GEMINI_API_KEY?.trim();

  const body = (thinkingOff: boolean) =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: call.system }] },
      contents: [{ role: "user", parts: [{ text: call.user }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: Math.max(maxTokens, 4096),
        responseMimeType: "application/json",
        // Extraction wants structured output, not reasoning. Thinking tokens
        // come out of this same budget and can consume all of it.
        ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    });

  const failures: string[] = [];
  const deadline = Date.now() + 32_000;

  for (const model of geminiChain()) {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}` +
      `:generateContent?key=${key}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() > deadline) {
        failures.push("deadline_reached");
        throw new Error(`gemini_unavailable [${failures.join(" | ")}]`);
      }

      let res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body(true),
      });

      // Models that predate thinkingConfig reject it outright.
      if (res.status === 400) {
        res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: body(false),
        });
      }

      if (isTransient(res.status)) {
        failures.push(`${model}:${res.status}`);
        await sleep(700 * (attempt + 1));
        continue;
      }

      if (!res.ok) {
        // A permanent error on this model: no point retrying it, try the next.
        failures.push(`${model}:${res.status} ${(await res.text()).slice(0, 160)}`);
        break;
      }

      const data = await res.json();
      const cand = data.candidates?.[0];
      // Thinking models return reasoning parts alongside the answer. Take
      // every part carrying text that is not flagged as a thought.
      const parts: { text?: string; thought?: boolean }[] = cand?.content?.parts ?? [];
      const raw = parts
        .filter((pt) => pt?.text && !pt.thought)
        .map((pt) => pt.text)
        .join("");

      if (raw) return { raw, model };

      failures.push(`${model}:empty(finishReason=${cand?.finishReason ?? "?"})`);
      break;
    }
  }

  throw new Error(`gemini_unavailable [${failures.join(" | ")}]`);
}

/**
 * Calls the configured model and parses a JSON object out of the reply.
 * Throws on any failure so the calling agent can fall back deterministically
 * rather than inventing data.
 */
export async function callModelJSON<T>(call: ModelCall): Promise<T> {
  const provider = activeProvider();
  if (!provider) throw new Error("no_provider_configured");

  const maxTokens = call.maxTokens ?? 1400;
  let raw: string;

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim()}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: call.system },
          { role: "user", content: call.user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`openai_${res.status}: ${await res.text()}`);
    const data = await res.json();
    raw = data.choices?.[0]?.message?.content ?? "";
  } else if (provider === "gemini") {
    const out = await geminiGenerate(call, maxTokens);
    lastGeminiModel = out.model;
    raw = out.raw;
  } else {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": (process.env.ANTHROPIC_API_KEY as string).trim(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        temperature: 0,
        system: call.system + "\n\nReply with a single JSON object and nothing else.",
        messages: [{ role: "user", content: call.user }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic_${res.status}: ${await res.text()}`);
    const data = await res.json();
    raw = data.content?.[0]?.text ?? "";
  }

  return parseJSONObject<T>(raw);
}

/** Tolerates a model that wraps JSON in prose or a code fence. */
export function parseJSONObject<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("model_returned_no_json");
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
