"use client";

import { ArrowUpRight, LoaderCircle, MessageSquareText, PenLine } from "lucide-react";
import { useState } from "react";
import type { PlanBody } from "./useAgentStream";

const INTERESTS = ["food", "music", "walks", "art", "books", "coffee", "history", "movies", "nature", "shopping"];
const CONSTRAINTS = ["vegetarian", "avoid crowded places", "no long commutes", "kid-friendly", "wheelchair accessible"];

const EXAMPLES = [
  { label: "Brief example", text: "I'm in Bangalore with ₹2000 and 4 hours. Tired but want to do something fun. I like food, music and walks. Vegetarian, and I'd rather avoid crowded places." },
  { label: "Vague request", text: "Plan something fun for my Saturday." },
  { label: "Evening for two, Mumbai", text: "My partner and I are in Mumbai with ₹3500 in total, free from 4pm to 10pm. We're feeling energetic and love art, the sea and good vegetarian food." },
  { label: "Tight budget, Delhi", text: "Delhi, only ₹500, three hours in the morning from 9am. I love history and walking. Pure vegetarian." },
];

function Chips({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              on
                ? "border-neutral-950 bg-neutral-950 text-white"
                : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-950"
            }`}
          >
            {o.charAt(0).toUpperCase() + o.slice(1)}
          </button>
        );
      })}
    </div>
  );
}

const label = "mb-1.5 block text-xs font-medium text-neutral-600";
const input =
  "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 transition focus:border-neutral-900 focus:outline-none focus:ring-4 focus:ring-neutral-200";

export function InputPanel({ onSubmit, running }: { onSubmit: (b: PlanBody) => void; running: boolean }) {
  const [mode, setMode] = useState<"text" | "form">("form");
  const [text, setText] = useState(EXAMPLES[0].text);
  const [f, setF] = useState({
    city: "Bangalore",
    area: "",
    budget: "2000",
    available_time: "4 hours",
    start_time: "",
    party_size: "1",
    mood: "tired but wants to do something fun",
  });
  const [interests, setInterests] = useState<string[]>(["food", "music", "walks"]);
  const [constraints, setConstraints] = useState<string[]>(["vegetarian", "avoid crowded places"]);
  const [extraC, setExtraC] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "text") return onSubmit({ text });
    onSubmit({
      form: {
        ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "")),
        budget: f.budget === "" ? undefined : Number(f.budget),
        party_size: Number(f.party_size) || 1,
        interests,
        constraints: [...constraints, ...extraC.split(",").map((s) => s.trim()).filter(Boolean)],
      },
    });
  };

  const tabs = [
    { id: "form" as const, label: "Fill a form", Icon: PenLine },
    { id: "text" as const, label: "Describe it", Icon: MessageSquareText },
  ];

  return (
    <form onSubmit={submit} className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm shadow-neutral-900/5">
      <div className="mb-5 grid grid-cols-2 rounded-full bg-cream p-1 text-sm" role="tablist">
        {tabs.map(({ id, label: l, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={`flex items-center justify-center gap-2 rounded-full py-2 font-medium transition ${
              mode === id ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {l}
          </button>
        ))}
      </div>

      {mode === "text" ? (
        <div className="space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            maxLength={1500}
            className={input}
            placeholder="Where you are, how much time and budget you have, how you're feeling and what you enjoy."
          />
          <div>
            <p className="mb-1.5 text-xs text-neutral-500">Try an example</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  onClick={() => setText(ex.text)}
                  className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-600 transition hover:border-neutral-400 hover:text-neutral-950"
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>City</label>
              <input className={input} value={f.city} onChange={set("city")} required />
            </div>
            <div>
              <label className={label}>Neighbourhood (optional)</label>
              <input className={input} value={f.area} onChange={set("area")} placeholder="e.g. Indiranagar" />
            </div>
            <div>
              <label className={label}>Total budget</label>
              <input className={input} value={f.budget} onChange={set("budget")} inputMode="numeric" placeholder="2000" />
            </div>
            <div>
              <label className={label}>Time available</label>
              <input className={input} value={f.available_time} onChange={set("available_time")} placeholder="4 hours" />
            </div>
            <div>
              <label className={label}>Start time (optional)</label>
              <input className={input} type="time" value={f.start_time} onChange={set("start_time")} />
            </div>
            <div>
              <label className={label}>People</label>
              <input className={input} value={f.party_size} onChange={set("party_size")} inputMode="numeric" />
            </div>
          </div>
          <div>
            <label className={label}>How are you feeling?</label>
            <input className={input} value={f.mood} onChange={set("mood")} placeholder="Tired, but up for something fun" />
          </div>
          <div>
            <label className={label}>Interests</label>
            <Chips options={INTERESTS} value={interests} onChange={setInterests} />
          </div>
          <div>
            <label className={label}>Constraints</label>
            <Chips options={CONSTRAINTS} value={constraints} onChange={setConstraints} />
            <input className={`${input} mt-2`} value={extraC} onChange={(e) => setExtraC(e.target.value)} placeholder="Anything else? Separate with commas" />
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={running}
        className="group mt-6 flex w-full items-center justify-between gap-2 rounded-full bg-neutral-950 py-2 pl-6 pr-2 text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-70"
      >
        <span>{running ? "Building your plan" : "Create my plan"}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-neutral-950">
          {running ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <ArrowUpRight className="h-4 w-4 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
          )}
        </span>
      </button>
    </form>
  );
}
