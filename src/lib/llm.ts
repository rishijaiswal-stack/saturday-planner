// Thin LLM layer over Groq (free tier). Responsibilities:
//  - model fallback chain: free-tier rate limits are per model, so on a 429 we
//    move to the next model (a separate bucket) instead of failing the user;
//  - short retry when Groq says "retry after a few seconds";
//  - streaming so reasoning tokens reach the UI live ("agent is thinking").
// Everything above this file is provider-agnostic: swapping to Claude/OpenAI
// means re-implementing `chat()` only.

import Groq, { APIConnectionError, APIError, AuthenticationError, RateLimitError } from "groq-sdk";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "groq-sdk/resources/chat/completions";

let client: Groq | null = null;
function groq(): Groq {
  if (!process.env.GROQ_API_KEY) throw new NoKeyError();
  client ??= new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0, timeout: 45_000 });
  return client;
}

export class NoKeyError extends Error {
  constructor() {
    super("GROQ_API_KEY is not set");
  }
}
export type LimitKind = "daily" | "minute" | "other";
export class AllModelsFailedError extends Error {
  constructor(message: string, public kind: LimitKind) {
    super(message);
  }
}

// A model that hit its daily free-tier cap is skipped for a while instead of
// being retried on every request (each retry adds latency and fails anyway).
const dailyBlockedUntil: Record<string, number> = {};
const isDaily = (msg: string) => /per day|\bTPD\b|\bRPD\b/i.test(msg);

const list = (env: string | undefined, dflt: string[]) => (env ? env.split(",").map((s) => s.trim()).filter(Boolean) : dflt);

// Extraction is easy -> small fast model first. Planning needs judgment ->
// strongest reasoning model first. Each list is a fallback chain; every model
// has its own free-tier rate-limit bucket, so the chain multiplies capacity.
export const MODELS = {
  understand: list(process.env.GROQ_UNDERSTAND_MODELS, ["openai/gpt-oss-20b", "qwen/qwen3.8-27b", "openai/gpt-oss-120b"]),
  plan: list(process.env.GROQ_PLAN_MODELS, ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"]),
};

// Per-model request knobs (reasoning params differ across model families).
function modelParams(model: string): Record<string, unknown> {
  if (model.startsWith("openai/gpt-oss")) return { reasoning_effort: process.env.GROQ_REASONING_EFFORT ?? "low" };
  if (model.startsWith("qwen/")) return { reasoning_format: "parsed", reasoning_effort: "low" };
  return {};
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface ChatResult {
  model: string;
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage: { input: number; output: number; cached: number };
}

export interface ChatOptions {
  models: string[];
  messages: ChatCompletionMessageParam[];
  tools: ChatCompletionTool[];
  toolChoice?: "auto" | "required";
  maxTokens?: number;
  onReasoning?: (delta: string) => void;
  onStatus?: (msg: string) => void;
  startModelIndex?: number;
}

export async function chat(opts: ChatOptions): Promise<ChatResult & { modelIndex: number }> {
  const errors: string[] = [];
  const kinds: LimitKind[] = [];
  for (let i = opts.startModelIndex ?? 0; i < opts.models.length; i++) {
    const model = opts.models[i];
    if ((dailyBlockedUntil[model] ?? 0) > Date.now()) {
      kinds.push("daily");
      errors.push(`${model}: daily limit (cached)`);
      continue;
    }
    let waited = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await chatOnce(model, opts);
        return { ...r, modelIndex: i };
      } catch (e) {
        if (e instanceof NoKeyError || e instanceof AuthenticationError) throw e;
        const msg = describe(e);
        errors.push(`${model}: ${msg}`);
        console.warn(`[groq] ${model} attempt ${attempt + 1}: ${msg}`); // visible in Vercel runtime logs
        if (e instanceof RateLimitError && isDaily(msg)) {
          kinds.push("daily");
          dailyBlockedUntil[model] = Date.now() + 10 * 60_000;
          opts.onStatus?.(`${model} has used its free daily allowance; switching model`);
          break;
        }
        if (e instanceof RateLimitError) {
          const wait = Number(e.headers?.get("retry-after") ?? "NaN");
          // TPM limits reset within seconds; a short visible wait on the best
          // model beats silently downgrading to a weaker one.
          if (wait > 0 && waited + wait <= 15) {
            waited += wait;
            opts.onStatus?.(`${model} rate-limited; retrying in ${wait}s`);
            await new Promise((r) => setTimeout(r, wait * 1000));
            continue;
          }
          kinds.push("minute");
          opts.onStatus?.(`${model} rate-limited; switching model`);
          break;
        }
        // Malformed tool call from the model (Groq: 400 tool_use_failed) -> one retry, then next model.
        // Mid-stream errors carry no HTTP status, so match on the error code/message.
        if (e instanceof APIError && (e.status === 400 || e.status === undefined) && /tool_use_failed|tool call|parsing failed|parse tool/i.test(msg) && attempt < 2) {
          opts.onStatus?.(`${model} produced a malformed tool call; retrying`);
          continue;
        }
        kinds.push("other");
        opts.onStatus?.(`${model} failed (${msg.slice(0, 80)}); trying next model`);
        break;
      }
    }
  }
  const kind: LimitKind = kinds.length && kinds.every((k) => k === "daily") ? "daily" : kinds.includes("minute") ? "minute" : kinds.includes("daily") ? "daily" : "other";
  throw new AllModelsFailedError(errors.join(" | "), kind);
}

function describe(e: unknown): string {
  if (e instanceof APIConnectionError) return "connection error";
  if (e instanceof APIError) {
    // Groq puts details either at e.error or e.error.error depending on the path.
    type Err = { message?: string; code?: string };
    const raw = e.error as (Err & { error?: Err }) | undefined;
    const inner = raw?.error ?? raw;
    return `${e.status ?? ""} ${inner?.code ?? ""} ${inner?.message ?? e.message}`.replace(/\s+/g, " ").trim();
  }
  return (e as Error)?.message ?? String(e);
}

async function chatOnce(model: string, opts: ChatOptions): Promise<ChatResult> {
  const stream = await groq().chat.completions.create({
    model,
    messages: opts.messages,
    tools: opts.tools,
    tool_choice: opts.toolChoice ?? "auto",
    max_completion_tokens: opts.maxTokens ?? 4096,
    temperature: 0.4,
    stream: true,
    ...modelParams(model),
  });

  let content = "";
  let reasoning = "";
  const calls = new Map<number, ToolCall>();
  let usage = { input: 0, output: 0, cached: 0 };
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.reasoning) {
      reasoning += delta.reasoning;
      opts.onReasoning?.(delta.reasoning);
    }
    if (delta?.content) content += delta.content;
    for (const tc of delta?.tool_calls ?? []) {
      const cur = calls.get(tc.index) ?? { id: "", name: "", arguments: "" };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.arguments += tc.function.arguments;
      calls.set(tc.index, cur);
    }
    const u = chunk.x_groq?.usage;
    // Groq caches exact prompt prefixes on gpt-oss models; cached tokens don't
    // count toward the free-tier TPM limit, so we track them separately.
    if (u) {
      const details = (u as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details;
      usage = { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, cached: details?.cached_tokens ?? 0 };
    }
  }
  // Some models leak <think> blocks into content; strip them.
  content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return { model, content, reasoning, toolCalls: [...calls.values()].filter((c) => c.name), usage };
}

export type { ChatCompletionMessageParam, ChatCompletionTool };
