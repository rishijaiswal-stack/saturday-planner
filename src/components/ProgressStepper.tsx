"use client";

// Four-phase progress view shown while the agent works, derived purely from the
// streamed events (no extra server state). Mirrors the backend phases, so the
// UI tells the same story as DESIGN.md: understand -> gather -> plan -> check.

import { BrainCircuit, Check, LoaderCircle, MapPin, Route, ShieldCheck, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { StreamState } from "./useAgentStream";

const PHASES: { title: string; hint: string; Icon: LucideIcon }[] = [
  { title: "Understanding", hint: "Reading your mood, time, budget and constraints", Icon: BrainCircuit },
  { title: "Finding places", hint: "Real places, live weather, ranked for you", Icon: MapPin },
  { title: "Planning", hint: "Choosing stops and weighing trade-offs", Icon: Route },
  { title: "Checking", hint: "Travel time, hours, budget, diet, crowds", Icon: ShieldCheck },
];

function currentPhase(state: StreamState): number {
  const names = new Set(state.steps.map((s) => s.name));
  const statuses = state.statuses.map((s) => s.message);
  let phase = 0;
  if (names.has("parse_preferences")) phase = 1;
  if (statuses.includes("Planning") || state.thinking || names.has("validate_plan") || names.has("search_places")) phase = 2;
  if (names.has("finalize_plan") || names.has("rules_planner")) phase = 3;
  return phase;
}

function latestDetail(state: StreamState, phase: number): string | null {
  const byPhase: Record<number, string[]> = {
    0: ["understand_request"],
    1: ["get_activity_options", "get_food_options", "get_weather", "parse_preferences"],
    2: ["validate_plan", "search_places"],
    3: ["finalize_plan", "rules_planner"],
  };
  for (const name of byPhase[phase]) {
    const s = [...state.steps].reverse().find((x) => x.name === name && x.summary);
    if (s?.summary) return s.summary;
  }
  return null;
}

export function ProgressStepper({ state }: { state: StreamState }) {
  const [now, setNow] = useState(() => state.startedAt ?? 0);
  useEffect(() => {
    if (!state.running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [state.running]);

  const phase = currentPhase(state);
  const elapsed = state.startedAt ? Math.max(0, Math.round((now - state.startedAt) / 1000)) : 0;
  const lastStatus = state.statuses[state.statuses.length - 1]?.message ?? "";
  const waiting = /rate-limited|retrying|switching model/i.test(lastStatus);
  const detail = latestDetail(state, phase);

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5" aria-live="polite">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <LoaderCircle className="h-4 w-4 animate-spin text-indigo-600" aria-hidden />
          Building your plan
        </h2>
        <span className="text-xs tabular-nums text-slate-400">{elapsed}s</span>
      </div>
      <ol className="grid grid-cols-4 gap-2">
        {PHASES.map((p, i) => {
          const done = i < phase;
          const active = i === phase;
          return (
            <li key={p.title} className="flex flex-col items-start">
              <div className="flex w-full items-center">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${
                    done
                      ? "bg-emerald-500 text-white"
                      : active
                        ? "bg-indigo-600 text-white ring-4 ring-indigo-100"
                        : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {done ? <Check className="h-4 w-4" aria-hidden /> : <p.Icon className="h-4 w-4" aria-hidden />}
                </span>
                {i < PHASES.length - 1 && (
                  <span className="mx-1.5 h-0.5 flex-1 overflow-hidden rounded bg-slate-200">
                    <span className={`block h-full bg-emerald-400 transition-all duration-500 ${done ? "w-full" : "w-0"}`} />
                  </span>
                )}
              </div>
              <p className={`mt-2 text-xs font-semibold ${active ? "text-slate-900" : done ? "text-slate-600" : "text-slate-400"}`}>{p.title}</p>
              <p className="mt-0.5 hidden text-[11px] leading-snug text-slate-400 sm:block">{p.hint}</p>
            </li>
          );
        })}
      </ol>
      <div className="mt-5 min-h-5 rounded-lg bg-slate-50 px-3 py-2 text-xs">
        {waiting ? (
          <p className="text-amber-700">The free AI tier is busy, so the agent is waiting or switching models. You will still get a checked plan.</p>
        ) : detail ? (
          <p className="text-slate-600">{detail}</p>
        ) : (
          <p className="text-slate-400">{PHASES[phase].hint}</p>
        )}
      </div>
    </section>
  );
}

export function PlanSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm" aria-hidden>
      <div className="h-32 animate-pulse bg-gradient-to-br from-indigo-200 via-violet-200 to-indigo-100" />
      <div className="h-56 animate-pulse bg-slate-100" />
      <div className="space-y-5 p-5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4">
            <div className="h-4 w-10 animate-pulse rounded bg-slate-200" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
