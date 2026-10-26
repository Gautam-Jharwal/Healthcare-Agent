/**
 * Provider-agnostic model client.
 *
 * Deliberately uses plain fetch rather than an SDK: fewer dependencies means
 * fewer ways for the Vercel build to fail the night before a deadline.
 *
 * Set ONE of these in your Vercel environment variables:
 *   OPENAI_API_KEY      -> uses gpt-4o-mini
 *   ANTHROPIC_API_KEY   -> uses claude-haiku-4-5
 *
 * With neither set the app still runs: every agent falls back to its
 * deterministic path and the UI reports mode = "seeded".
 */

const OPENAI_MODEL = process.env.SURE_OPENAI_MODEL ?? "gpt-4o-mini";
const ANTHROPIC_MODEL = process.env.SURE_ANTHROPIC_MODEL ?? "claude-haiku-4-5";

export function activeProvider(): "openai" | "anthropic" | null {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export function activeModelVersion(): string | null {
  const p = activeProvider();
  if (p === "openai") return OPENAI_MODEL;
  if (p === "anthropic") return ANTHROPIC_MODEL;
  return null;
}

export interface ModelCall {
  system: string;
  user: string;
  /** Maximum tokens for the reply. Kept small; these are extraction tasks. */
  maxTokens?: number;
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
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
  } else {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY as string,
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
