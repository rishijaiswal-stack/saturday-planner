"use client";

import { useState } from "react";
import { ClarifyCard } from "@/components/ClarifyCard";
import { InputPanel } from "@/components/InputPanel";
import { PlanView } from "@/components/PlanView";
import { PlanSkeleton, ProgressStepper } from "@/components/ProgressStepper";
import { TracePanel } from "@/components/TracePanel";
import { useAgentStream, type PlanBody } from "@/components/useAgentStream";

export default function Home() {
  const { state, run, reset } = useAgentStream();
  const [lastBody, setLastBody] = useState<PlanBody | null>(null);

  const submit = (b: PlanBody) => {
    setLastBody(b);
    run(b);
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
      <header className="mb-8">
        <p className="text-sm font-medium text-orange-600">🌤️ Perfect Saturday</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">Tell me your vibe. I&apos;ll plan the day.</h1>
        <p className="mt-2 max-w-2xl text-sm text-stone-600">
          An AI agent that checks real places (OpenStreetMap), the real weather forecast, travel times and your budget, then explains why each stop fits
          you. Watch it work on the right.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-6">
          <InputPanel onSubmit={submit} running={state.running} />
          <p className="px-1 text-[11px] leading-relaxed text-stone-400">
            Places: OpenStreetMap (Geoapify/Photon) + a small curated list. Weather: Open-Meteo. LLM: open models on Groq. Prices for live places
            and crowd levels are estimates and are labelled as such.
          </p>
        </div>

        <div className="space-y-6">
          {state.error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              {state.error}
              {lastBody && (
                <button type="button" onClick={() => run(lastBody)} className="ml-2 font-semibold underline">
                  Try again
                </button>
              )}
            </div>
          )}
          {state.clarify && !state.running && (
            <ClarifyCard
              questions={state.clarify.questions}
              reason={state.clarify.reason}
              onAnswer={(answers) => {
                const b = { ...(lastBody ?? {}), answers };
                setLastBody(b);
                run(b, true);
              }}
            />
          )}
          {state.plan && (
            <PlanView
              plan={state.plan}
              onRestart={() => {
                reset();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          )}
          {state.running && !state.plan && (
            <>
              <ProgressStepper state={state} />
              <PlanSkeleton />
            </>
          )}
          <TracePanel state={state} />
          {!state.running && !state.plan && !state.clarify && state.steps.length === 0 && !state.error && (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-white/60 p-8 text-center">
              <p className="text-4xl">🗺️</p>
              <p className="mt-2 text-sm font-medium text-stone-700">Your plan will appear here</p>
              <p className="mt-1 max-w-sm text-xs text-stone-500">
                The form is pre-filled with the example from the brief. Hit “Plan my Saturday”, or switch to “Just tell me” and try the vague
                example to see the agent ask clarifying questions.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
