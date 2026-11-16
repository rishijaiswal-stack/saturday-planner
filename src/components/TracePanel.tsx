"use client";

import {
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  CloudSun,
  FileCheck2,
  LifeBuoy,
  ListChecks,
  MapPin,
  Navigation,
  Search,
  ShieldCheck,
  TriangleAlert,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StreamState, TraceStep } from "./useAgentStream";

const META: Record<string, { Icon: LucideIcon; label: string; kind: "llm" | "tool" }> = {
  understand_request: { Icon: BrainCircuit, label: "Understand request", kind: "llm" },
  parse_preferences: { Icon: Navigation, label: "parse_preferences", kind: "tool" },
  get_weather: { Icon: CloudSun, label: "get_weather", kind: "tool" },
  get_activity_options: { Icon: MapPin, label: "get_activity_options", kind: "tool" },
  get_food_options: { Icon: Utensils, label: "get_food_options", kind: "tool" },
  search_places: { Icon: Search, label: "search_places", kind: "tool" },
  validate_plan: { Icon: ShieldCheck, label: "validate_plan", kind: "tool" },
  finalize_plan: { Icon: FileCheck2, label: "finalize_plan · server re-validates", kind: "tool" },
  rules_planner: { Icon: LifeBuoy, label: "Rule-based fallback planner", kind: "tool" },
};

const NOTABLE = /rate-limited|unavailable|failed|malformed|rule-based|couldn't|ran out|incomplete|validated draft/i;

function Step({ s }: { s: TraceStep }) {
  const [open, setOpen] = useState(false);
  const m = META[s.name] ?? { Icon: ListChecks, label: s.name, kind: "tool" as const };
  const tone =
    s.status === "fail" ? "bg-amber-50 text-amber-600 ring-amber-200" : m.kind === "llm" ? "bg-violet-50 text-violet-600 ring-violet-200" : "bg-indigo-50 text-indigo-600 ring-indigo-200";
  return (
    <li className="relative pl-10">
      <span className={`absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${tone}`}>
        <m.Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left" aria-expanded={open}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-slate-800">{m.label}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              m.kind === "llm" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"
            }`}
          >
            {m.kind === "llm" ? "LLM" : "Code"}
          </span>
          {s.status === "running" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" aria-label="running" />}
          {s.status === "fail" && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">
              {s.name === "finalize_plan" || s.name === "validate_plan" ? "Rejected, revising" : "Degraded"}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 text-[10px] tabular-nums text-slate-400">
            {s.ms !== undefined && s.status !== "running" ? `${s.ms} ms` : ""}
            {open ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
          </span>
        </div>
        {s.summary && <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{s.summary}</p>}
      </button>
      {open && (
        <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] leading-relaxed text-slate-100">
          {JSON.stringify({ input: s.input, output: s.data }, null, 2)}
        </pre>
      )}
    </li>
  );
}

export function TracePanel({ state }: { state: StreamState }) {
  const [showThinking, setShowThinking] = useState(false);
  const thinkRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    thinkRef.current?.scrollTo({ top: thinkRef.current.scrollHeight });
  }, [state.thinking]);

  if (!state.running && state.steps.length === 0 && state.statuses.length === 0) return null;
  const elapsed = state.startedAt && state.finishedAt ? ((state.finishedAt - state.startedAt) / 1000).toFixed(1) : null;
  const notable = state.statuses.filter((s) => NOTABLE.test(s.message));

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Agent activity</h2>
          <p className="text-xs text-slate-500">Every tool call, in order. Select a step to see its input and output.</p>
        </div>
        <span className="shrink-0 text-right text-[11px] tabular-nums text-slate-400">
          {state.running ? "Live" : elapsed ? `${elapsed}s` : ""}
          {state.usage && state.usage.turns > 0 ? (
            <>
              <br />
              {state.usage.turns} LLM calls · {(state.usage.input + state.usage.output).toLocaleString()} tokens
              {state.usage.cache_read ? ` (${state.usage.cache_read.toLocaleString()} cached)` : ""}
            </>
          ) : null}
        </span>
      </div>
      <ol className="space-y-3.5">
        {state.steps.map((s) => (
          <Step key={s.id} s={s} />
        ))}
      </ol>
      {state.thinking && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <button type="button" onClick={() => setShowThinking(!showThinking)} className="flex items-center gap-1 text-xs font-semibold text-violet-700" aria-expanded={showThinking}>
            {showThinking ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
            Model reasoning, streamed live
          </button>
          {showThinking && (
            <div ref={thinkRef} className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-violet-50/70 p-3 text-[11px] leading-relaxed text-violet-950">
              {state.thinking}
            </div>
          )}
        </div>
      )}
      {notable.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-slate-100 pt-3">
          {notable.map((s, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700">
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {s.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
