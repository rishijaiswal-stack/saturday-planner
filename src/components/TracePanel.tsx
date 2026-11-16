"use client";

import { useEffect, useRef, useState } from "react";
import type { StreamState, TraceStep } from "./useAgentStream";

const META: Record<string, { icon: string; label: string; kind: "llm" | "tool" }> = {
  understand_request: { icon: "🧠", label: "Understand request", kind: "llm" },
  parse_preferences: { icon: "🧭", label: "parse_preferences", kind: "tool" },
  get_weather: { icon: "🌦️", label: "get_weather", kind: "tool" },
  get_activity_options: { icon: "🎵", label: "get_activity_options", kind: "tool" },
  get_food_options: { icon: "🍛", label: "get_food_options", kind: "tool" },
  search_places: { icon: "🔎", label: "search_places", kind: "tool" },
  validate_plan: { icon: "✅", label: "validate_plan", kind: "tool" },
  finalize_plan: { icon: "📋", label: "finalize_plan (server re-validates)", kind: "tool" },
  rules_planner: { icon: "🛟", label: "Rule-based fallback planner", kind: "tool" },
};

function Step({ s }: { s: TraceStep }) {
  const [open, setOpen] = useState(false);
  const m = META[s.name] ?? { icon: "🔧", label: s.name, kind: "tool" };
  return (
    <li className="relative pl-7">
      <span className="absolute left-0 top-0.5 text-base">{m.icon}</span>
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-stone-800">{m.label}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              m.kind === "llm" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"
            }`}
          >
            {m.kind === "llm" ? "LLM" : "code"}
          </span>
          {s.status === "running" && <span className="h-2 w-2 animate-pulse rounded-full bg-orange-500" />}
          {s.status === "fail" && <span className="text-[10px] font-medium text-amber-600">degraded</span>}
          {s.ms !== undefined && s.status !== "running" && <span className="ml-auto text-[10px] text-stone-400">{s.ms} ms</span>}
        </div>
        {s.summary && <p className="mt-0.5 text-xs text-stone-600">{s.summary}</p>}
      </button>
      {open && (
        <pre className="mt-1.5 max-h-60 overflow-auto rounded-lg bg-stone-900 p-2 text-[10px] leading-relaxed text-stone-100">
          {JSON.stringify({ input: s.input, output: s.data }, null, 2)}
        </pre>
      )}
    </li>
  );
}

export function TracePanel({ state }: { state: StreamState }) {
  const [showThinking, setShowThinking] = useState(true);
  const thinkRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    thinkRef.current?.scrollTo({ top: thinkRef.current.scrollHeight });
  }, [state.thinking]);

  if (!state.running && state.steps.length === 0 && state.statuses.length === 0) return null;
  const elapsed = state.startedAt && state.finishedAt ? ((state.finishedAt - state.startedAt) / 1000).toFixed(1) : null;
  const lastStatus = state.statuses[state.statuses.length - 1]?.message;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-900">What the agent is doing</h2>
        <span className="text-xs text-stone-400">
          {state.running ? "live" : elapsed ? `${elapsed}s` : ""}
          {state.usage && state.usage.turns > 0 ? ` · ${state.usage.turns} LLM calls · ${(state.usage.input + state.usage.output).toLocaleString()} tokens` : ""}
        </span>
      </div>
      {state.running && lastStatus && <p className="mb-3 text-xs italic text-orange-700">{lastStatus}…</p>}
      <ol className="space-y-3 border-l border-dashed border-stone-200 pl-1">
        {state.steps.map((s) => (
          <Step key={s.id} s={s} />
        ))}
      </ol>
      {state.thinking && (
        <div className="mt-4">
          <button type="button" onClick={() => setShowThinking(!showThinking)} className="text-xs font-medium text-violet-700">
            {showThinking ? "▾" : "▸"} Model reasoning (streamed)
          </button>
          {showThinking && (
            <div ref={thinkRef} className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-violet-50 p-2.5 text-[11px] leading-relaxed text-violet-900">
              {state.thinking}
            </div>
          )}
        </div>
      )}
      {state.statuses.some((s) => /rate-limited|unavailable|failed|malformed|rule-based/i.test(s.message)) && (
        <ul className="mt-3 space-y-1">
          {state.statuses
            .filter((s) => /rate-limited|unavailable|failed|malformed|rule-based|couldn't|ran out/i.test(s.message))
            .map((s, i) => (
              <li key={i} className="text-[11px] text-amber-700">
                ⚠︎ {s.message}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
