// Live AI capacity tracking for the free Groq tier.
// Groq returns per-minute token and per-day request counters in every
// response's headers. The daily *token* allowance is not in the headers; it
// only appears in the 429 error once exhausted ("Limit 200000, Used 199532 ...
// Please try again in 11m42.6s"), so we parse that too.
//
// Two sources keep this cheap:
//  - every real plan request records the headers it already received (free);
//  - GET /api/ai-status makes one tiny probe call (~15 tokens) at most every
//    5 minutes per server instance, so status checks can't eat the 1,000
//    requests/day allowance.

import Groq, { RateLimitError } from "groq-sdk";
import type { AiStatus } from "./types";

const snapshots = new Map<string, AiStatus>();
const PROBE_TTL = 5 * 60_000;
// A plan needs roughly 4K tokens; below this the next plan would likely wait.
const TOKENS_PER_PLAN = 4000;

/** "6m28.8s" | "59.5s" | "1h2m3s" | "120ms" -> seconds */
export function parseGroqDuration(s: string | null | undefined): number | undefined {
  if (!s) return undefined;
  let total = 0;
  let matched = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    const n = Number(m[1]);
    total += m[2] === "h" ? n * 3600 : m[2] === "m" ? n * 60 : m[2] === "s" ? n : n / 1000;
  }
  if (matched) return total;
  const plain = Number(s);
  return Number.isFinite(plain) ? plain : undefined;
}

const num = (v: string | null) => (v == null || v === "" ? undefined : Number(v));

export function recordHeaders(model: string, h: Headers, source: AiStatus["source"] = "plan"): AiStatus {
  const tokensLeft = num(h.get("x-ratelimit-remaining-tokens"));
  const resetTokens = parseGroqDuration(h.get("x-ratelimit-reset-tokens"));
  const s: AiStatus = {
    state: tokensLeft !== undefined && tokensLeft < TOKENS_PER_PLAN * 0.6 ? "busy" : "ready",
    model,
    tokens_left_minute: tokensLeft,
    tokens_limit_minute: num(h.get("x-ratelimit-limit-tokens")),
    requests_left_today: num(h.get("x-ratelimit-remaining-requests")),
    requests_limit_today: num(h.get("x-ratelimit-limit-requests")),
    retry_at: tokensLeft !== undefined && tokensLeft < TOKENS_PER_PLAN * 0.6 && resetTokens ? Date.now() + resetTokens * 1000 : undefined,
    checked_at: Date.now(),
    source,
  };
  snapshots.set(model, s);
  return s;
}

export function recordLimitError(model: string, message: string, h?: Headers | null, source: AiStatus["source"] = "plan"): AiStatus {
  const daily = /per day|\bTPD\b|\bRPD\b/i.test(message);
  const tryAgain = parseGroqDuration(/try again in ([\dhms.]+)/i.exec(message)?.[1]) ?? num(h?.get("retry-after") ?? null);
  const used = /Used (\d+)/i.exec(message)?.[1];
  const limit = /Limit (\d+)/i.exec(message)?.[1];
  const prev = snapshots.get(model);
  const s: AiStatus = {
    ...prev,
    state: daily ? "daily_limit" : "busy",
    model,
    daily_used: daily && used ? Number(used) : prev?.daily_used,
    daily_limit: daily && limit ? Number(limit) : prev?.daily_limit,
    retry_at: tryAgain ? Date.now() + tryAgain * 1000 : undefined,
    checked_at: Date.now(),
    source,
  };
  snapshots.set(model, s);
  return s;
}

export function latestStatus(model: string): AiStatus | undefined {
  return snapshots.get(model);
}

let probing: Promise<AiStatus> | null = null;

export async function getAiStatus(model: string): Promise<AiStatus> {
  if (!process.env.GROQ_API_KEY) return { state: "not_configured", model, checked_at: Date.now(), source: "probe" };
  const cached = snapshots.get(model);
  const blockedUntilPassed = cached?.retry_at !== undefined && cached.retry_at <= Date.now();
  if (cached && Date.now() - cached.checked_at < PROBE_TTL && !blockedUntilPassed) return cached;
  probing ??= probe(model).finally(() => (probing = null));
  return probing;
}

async function probe(model: string): Promise<AiStatus> {
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0, timeout: 10_000 });
  try {
    const { response } = await client.chat.completions
      .create({ model, messages: [{ role: "user", content: "ok" }], max_completion_tokens: 1 })
      .withResponse();
    return recordHeaders(model, response.headers, "probe");
  } catch (e) {
    if (e instanceof RateLimitError) {
      const body = e.error as { error?: { message?: string }; message?: string } | undefined;
      const msg = body?.error?.message ?? body?.message ?? e.message;
      return recordLimitError(model, msg, e.headers, "probe");
    }
    const s: AiStatus = { state: "unavailable", model, checked_at: Date.now(), source: "probe" };
    snapshots.set(model, s);
    return s;
  }
}
