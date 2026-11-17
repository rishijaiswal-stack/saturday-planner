"use client";

import { CloudSun, Compass, MapPin, RotateCcw, Route, ShieldCheck, TriangleAlert, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { AiStatusPill } from "@/components/AiStatusPill";
import { ClarifyCard } from "@/components/ClarifyCard";
import { InputPanel } from "@/components/InputPanel";
import { PlanView } from "@/components/PlanView";
import { PlanSkeleton, ProgressStepper } from "@/components/ProgressStepper";
import { TracePanel } from "@/components/TracePanel";
import { useAgentStream, type PlanBody } from "@/components/useAgentStream";

const FEATURES: { Icon: LucideIcon; title: string; text: string }[] = [
  { Icon: MapPin, title: "Real places", text: "OpenStreetMap venues, never invented" },
  { Icon: CloudSun, title: "Live weather", text: "Saturday's hourly forecast" },
  { Icon: ShieldCheck, title: "Checked plans", text: "Hours, travel, budget and diet verified" },
];

export default function Home() {
  const { state, run, reset } = useAgentStream();
  const [lastBody, setLastBody] = useState<PlanBody | null>(null);

  const submit = (b: PlanBody) => {
    setLastBody(b);
    run(b);
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-950 text-white shadow-sm">
              <Compass className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-sm font-semibold tracking-tight text-neutral-900">Saturday Planner</span>
          </div>
          <AiStatusPill pushed={state.aiStatus} />
        </div>
        <p className="mt-10 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-700">AI agent · Real places · Live weather</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-neutral-950 sm:text-[3.4rem] sm:leading-[1.08]">
          A Saturday plan that fits{" "}
          <span className="text-neutral-400">your mood, time and budget.</span>
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-neutral-600">
          Tell the planner where you are and how you feel. It finds real places nearby, checks the forecast, travel time and opening hours, and explains
          every choice it makes.
        </p>
        <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
          {FEATURES.map(({ Icon, title, text }) => (
            <li key={title} className="flex items-center gap-2 text-xs text-neutral-500">
              <Icon className="h-4 w-4 text-neutral-900" aria-hidden />
              <span className="font-semibold text-neutral-700">{title}</span>
              <span className="hidden sm:inline">· {text}</span>
            </li>
          ))}
        </ul>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Sticky on desktop so the form stays visible while a long plan scrolls. */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pb-2">
          <InputPanel onSubmit={submit} running={state.running} />
          <p className="px-1 text-[11px] leading-relaxed text-neutral-400">
            Data: OpenStreetMap via Geoapify and Photon, plus a small curated list. Weather: Open-Meteo. Language models: open models on Groq. Prices for
            live places and crowd levels are estimates and are labelled as such.
          </p>
        </div>

        <div className="space-y-6">
          {state.error && (
            <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div className="flex-1">
                {state.error}
                {lastBody && (
                  <button type="button" onClick={() => run(lastBody)} className="ml-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2">
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    Try again
                  </button>
                )}
              </div>
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
            <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-white/70 p-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cream text-neutral-900 ring-1 ring-inset ring-neutral-200">
                <Route className="h-6 w-6" aria-hidden />
              </span>
              <p className="mt-3 text-sm font-semibold text-neutral-800">Your plan will appear here</p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-neutral-500">
                The form is pre-filled with the example from the brief. Select &ldquo;Create my plan&rdquo;, or switch to &ldquo;Describe it&rdquo; and try the
                vague request to see the agent ask clarifying questions.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
