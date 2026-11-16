"use client";

// Four-phase progress view shown while the agent works, derived purely from the
// streamed events (no extra server state). Mirrors the backend phases, so the
// UI tells the same story as DESIGN.md: understand -> gather -> plan -> check.

import { useEffect, useState } from "react";
import type { StreamState } from "./useAgentStream";

const PHASES = [
  { title: "Understanding you", hint: "Reading your mood, time, budget and constraints" },
  { title: "Finding real places", hint: "OpenStreetMap places, live weather, ranking for you" },
  { title: "Planning", hint: "Choosing stops and weighing trade-offs" },
  { title: "Checking the plan", hint: "Travel times, opening hours, budget, diet, crowds" },
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
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm" aria-live="polite">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-900">Planning your Saturday…</h2>
        <span className="text-xs tabular-nums text-stone-400">{elapsed}s</span>
      </div>
      <ol className="grid grid-cols-4 gap-2">
        {PHASES.map((p, i) => {
          const done = i < phase;
          const active = i === phase;
          return (
            <li key={p.title} className="flex flex-col items-start">
              <div className="flex w-full items-center">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition ${
                    done ? "bg-emerald-500 text-white" : active ? "bg-orange-500 text-white ring-4 ring-orange-100" : "bg-stone-100 text-stone-400"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                {i < PHASES.length - 1 && <span className={`mx-1.5 h-0.5 flex-1 rounded ${done ? "bg-emerald-400" : "bg-stone-200"}`} />}
              </div>
              <p className={`mt-2 text-[11px] font-semibold leading-tight sm:text-xs ${active ? "text-stone-900" : done ? "text-stone-600" : "text-stone-400"}`}>
                {p.title}
              </p>
              <p className="mt-0.5 hidden text-[11px] leading-snug text-stone-400 sm:block">{p.hint}</p>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 min-h-5 text-xs">
        {waiting ? (
          <p className="text-amber-700">⏳ Free AI tier is busy: {lastStatus}. Hang tight, I won&apos;t leave you without a plan.</p>
        ) : detail ? (
          <p className="text-stone-600">
            <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-orange-500 align-middle" />
            {detail}
          </p>
        ) : (
          <p className="text-stone-400">{PHASES[phase].hint}…</p>
        )}
      </div>
    </section>
  );
}

export function PlanSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm" aria-hidden>
      <div className="h-28 animate-pulse bg-gradient-to-br from-orange-200 to-rose-200" />
      <div className="h-48 animate-pulse bg-stone-100" />
      <div className="space-y-4 p-5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4">
            <div className="h-4 w-10 animate-pulse rounded bg-stone-200" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/2 animate-pulse rounded bg-stone-200" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-stone-100" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-stone-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
