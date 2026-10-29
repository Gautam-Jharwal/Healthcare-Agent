/**
 * Provider-agnostic model client with a model fallback chain.
 *
 * Plain fetch, no SDK: fewer dependencies, fewer ways for a build to fail.
 *
 * Set ONE key in the deployment environment:
 *   GEMINI_API_KEY      Google AI Studio (has a free tier)
 *   OPENAI_API_KEY      OpenAI
 *   ANTHROPIC_API_KEY   Anthropic
 *
 * Model names change. Each provider has a chain; if a model has been retired
 * (HTTP 404, or 400 "model not found"), the next is tried and the working one
 * is remembered. Override the first choice with SURE_MODEL.
 *
 * The run records every call. The UI says "live" only when every call in the
 * run succeeded; otherwise it says "degraded" and shows which agent fell back.
 */

import type { ModelCallRecord } from "./types";

export type Provider = "openai" | "anthropic" | "gemini" | "mock";

const CHAINS: Record<Exclude<Provider, "mock">, string[]> = {
  gemini: ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-3-flash-preview"],
  openai: ["gpt-4.1-mini", "gpt-4o-mini"],
  anthropic: ["claude-haiku-5-5", "claude-haiku-4-5"],
};

export function configuredProvider(): Provider | null {
  if (process.env.SURE_MOCK_LLM === "1") return "mock";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export function modelChain(p: Provider | null): string[] {
  if (!p) return [];
  if (p === "mock") return ["mock-model (test only)"];
  const first = process.env.SURE_MODEL?.trim();
  const chain = CHAINS[p];
  return first ? [first, ...chain.filter((m) => m !== first)] : chain;
}

/** Remembered across requests while the server instance is warm. */
const workingModel: Partial<Record<Provider, string>> = {};
const deadModels = new Set<string>();

export interface RunCtx {
  provider: Provider | null;
  calls: ModelCallRecord[];
  startedAt: number;
  /** Optional model calls are skipped once this much time has passed. */
  softBudgetMs: number;
  attempt: Record<string, number>;
}

export function newRunCtx(): RunCtx {
  return { provider: configuredProvider(), calls: [], startedAt: Date.now(), softBudgetMs: 38000, attempt: {} };
}

export function overBudget(ctx: RunCtx): boolean {
  return Date.now() - ctx.startedAt > ctx.softBudgetMs;
}

export interface ModelCall<T> {
  agent: string;
  purpose: string;
  system: string;
  user: string;
  maxTokens?: number;
  /** Deterministic stand-in used only when SURE_MOCK_LLM=1, for tests. */
  mock: (attempt: number) => T;
}

class ModelNotFound extends Error {}
/** The model exists but cannot answer right now: overloaded, rate limited or too slow. */
class ModelBusy extends Error {}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ac.signal });
    const text = await res.text();
    if (res.status === 404 || (res.status === 400 && /model|not found|not supported/i.test(text))) throw new ModelNotFound(`${res.status}`);
    // Overloaded or rate limited: the model is fine, it is just busy. Treated
    // as busy rather than fatal so the chain moves on instead of giving up.
    if (res.status === 429 || res.status >= 500) throw new ModelBusy(`${res.status}`);
    if (!res.ok) throw new Error(`http_${res.status}: ${text.slice(0, 160)}`);
    return JSON.parse(text);
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw new ModelBusy("timeout");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function callOnce(p: Exclude<Provider, "mock">, model: string, c: ModelCall<unknown>): Promise<string> {
  const maxTokens = c.maxTokens ?? 1600;
  const timeout = 12000; // three models must fit inside one serverless invocation
  if (p === "openai") {
    const data = await post(
      "https://api.openai.com/v1/chat/completions",
      { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      { model, temperature: 0, max_tokens: maxTokens, response_format: { type: "json_object" }, messages: [{ role: "system", content: c.system }, { role: "user", content: c.user }] },
      timeout,
    );
    return data.choices?.[0]?.message?.content ?? "";
  }
  if (p === "gemini") {
    const data = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { "x-goog-api-key": process.env.GEMINI_API_KEY as string },
      {
        systemInstruction: { parts: [{ text: c.system }] },
        contents: [{ role: "user", parts: [{ text: c.user }] }],
        // Extraction wants structured output, not reasoning. Thinking tokens are
        // drawn from the same budget and can consume all of it, leaving an empty
        // answer, so switch it off and keep headroom for the JSON itself.
        generationConfig: { temperature: 0, maxOutputTokens: Math.max(maxTokens * 3, 8192), responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
      },
      timeout,
    ).catch((e: Error) => {
      // A model that predates thinkingConfig rejects it; ask again without.
      if (!/thinking/i.test(e.message)) throw e;
      return post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { "x-goog-api-key": process.env.GEMINI_API_KEY as string },
        {
          systemInstruction: { parts: [{ text: c.system }] },
          contents: [{ role: "user", parts: [{ text: c.user }] }],
          generationConfig: { temperature: 0, maxOutputTokens: Math.max(maxTokens * 3, 8192), responseMimeType: "application/json" },
        },
        timeout,
      );
    });
    // Thinking models return reasoning parts beside the answer; those would
    // corrupt the JSON, so keep only parts not flagged as thoughts.
    return (data.candidates?.[0]?.content?.parts ?? [])
      .filter((x: { text?: string; thought?: boolean }) => x?.text && !x.thought)
      .map((x: { text?: string }) => x.text ?? "").join("");
  }
  const data = await post(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": process.env.ANTHROPIC_API_KEY as string, "anthropic-version": "2023-06-01" },
    { model, max_tokens: maxTokens, temperature: 0, system: c.system + "\n\nReply with a single JSON object and nothing else.", messages: [{ role: "user", content: c.user }] },
    timeout,
  );
  return (data.content ?? []).map((x: { text?: string }) => x.text ?? "").join("");
}

/**
 * Calls the configured model and parses a JSON object from the reply.
 * Throws on failure so the calling agent falls back deterministically
 * rather than inventing data. Every call is recorded on the run.
 */
export async function callModelJSON<T>(ctx: RunCtx, c: ModelCall<T>): Promise<T> {
  const p = ctx.provider;
  if (!p) throw new Error("no_provider_configured");
  const key = `${c.agent}:${c.purpose}`;
  ctx.attempt[key] = (ctx.attempt[key] ?? 0) + 1;
  const started = Date.now();

  if (p === "mock") {
    await new Promise((r) => setTimeout(r, 40));
    const out = c.mock(ctx.attempt[key]);
    ctx.calls.push({ agent: c.agent, purpose: c.purpose, model: "mock-model", ok: true, ms: Date.now() - started });
    return out;
  }

  const chain = modelChain(p);
  const ordered = workingModel[p] ? [workingModel[p]!, ...chain.filter((m) => m !== workingModel[p])] : chain;
  let lastErr = "no_model_available";
  for (const model of ordered) {
    if (deadModels.has(`${p}:${model}`)) continue;
    try {
      const raw = await callOnce(p, model, c as ModelCall<unknown>);
      const parsed = parseJSONObject<T>(raw);
      workingModel[p] = model;
      ctx.calls.push({ agent: c.agent, purpose: c.purpose, model, ok: true, ms: Date.now() - started });
      return parsed;
    } catch (e) {
      if (e instanceof ModelNotFound) {
        deadModels.add(`${p}:${model}`);
        lastErr = `model ${model} not available`;
        continue;
      }
      if (e instanceof ModelBusy) {
        // Not cached as dead: it will probably answer again in a minute.
        lastErr = `model ${model} busy (${e.message})`;
        continue;
      }
      lastErr = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : "unknown_error";
      ctx.calls.push({ agent: c.agent, purpose: c.purpose, model, ok: false, ms: Date.now() - started, error: lastErr });
      throw new Error(lastErr);
    }
  }
  ctx.calls.push({ agent: c.agent, purpose: c.purpose, model: null, ok: false, ms: Date.now() - started, error: lastErr });
  throw new Error(lastErr);
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

/** Cheap one-shot check used by the header badge so it never claims a model that does not answer. */
let healthCache: { at: number; result: { ok: boolean; model: string | null; error?: string } } | null = null;
export async function pingModel(): Promise<{ ok: boolean; model: string | null; error?: string; provider: Provider | null; cached: boolean }> {
  const provider = configuredProvider();
  if (!provider) return { ok: false, model: null, provider, cached: false, error: "no key configured" };
  if (healthCache && Date.now() - healthCache.at < 5 * 60 * 1000) return { ...healthCache.result, provider, cached: true };
  const ctx = newRunCtx();
  try {
    await callModelJSON(ctx, {
      agent: "health",
      purpose: "ping",
      system: "You are a health check.",
      user: 'Reply with {"ok": true}',
      maxTokens: 20,
      mock: () => ({ ok: true }),
    });
    healthCache = { at: Date.now(), result: { ok: true, model: ctx.calls[0]?.model ?? null } };
  } catch (e) {
    healthCache = { at: Date.now(), result: { ok: false, model: null, error: e instanceof Error ? e.message : "error" } };
  }
  return { ...healthCache.result, provider, cached: false };
}
