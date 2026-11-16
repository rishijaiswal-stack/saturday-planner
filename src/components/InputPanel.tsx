"use client";

import { useState } from "react";
import type { PlanBody } from "./useAgentStream";

const INTERESTS = ["food", "music", "walks", "art", "books", "coffee", "history", "movies", "nature", "shopping"];
const CONSTRAINTS = ["vegetarian", "avoid crowded places", "no long commutes", "kid-friendly", "wheelchair accessible"];

const EXAMPLES = [
  { label: "Brief's example", text: "I'm in Bangalore with ₹2000 and 4 hours. Tired but want to do something fun. I like food, music and walks. Vegetarian, and I'd rather avoid crowded places." },
  { label: "Vague (asks questions)", text: "plan something fun for my saturday" },
  { label: "Date in Mumbai", text: "Me and my partner in Mumbai, ₹3500 total, from 4pm to 10pm. Feeling energetic! We love art, the sea and good vegetarian food." },
  { label: "Tight budget, Delhi", text: "Delhi, only ₹500, 3 hours in the morning, love history and walking. Pure veg." },
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
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${
              on ? "border-orange-500 bg-orange-500 text-white" : "border-stone-300 bg-white text-stone-700 hover:border-orange-400"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

const label = "block text-xs font-medium text-stone-600 mb-1";
const input =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200";

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

  return (
    <form onSubmit={submit} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex rounded-lg bg-stone-100 p-1 text-sm">
        {(["form", "text"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-md py-1.5 font-medium transition ${mode === m ? "bg-white text-stone-900 shadow-sm" : "text-stone-500"}`}
          >
            {m === "form" ? "Quick form" : "Just tell me"}
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
            placeholder="Where are you, how much time and money, what's your mood, what do you like?"
          />
          <div>
            <p className="mb-1.5 text-xs text-stone-500">Try an example:</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  onClick={() => setText(ex.text)}
                  className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs text-stone-600 hover:border-orange-400"
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>City</label>
              <input className={input} value={f.city} onChange={set("city")} required />
            </div>
            <div>
              <label className={label}>Area (optional)</label>
              <input className={input} value={f.area} onChange={set("area")} placeholder="e.g. Indiranagar" />
            </div>
            <div>
              <label className={label}>Budget (total)</label>
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
            <label className={label}>Mood</label>
            <input className={input} value={f.mood} onChange={set("mood")} placeholder="tired but wants to do something fun" />
          </div>
          <div>
            <label className={label}>Interests</label>
            <Chips options={INTERESTS} value={interests} onChange={setInterests} />
          </div>
          <div>
            <label className={label}>Constraints</label>
            <Chips options={CONSTRAINTS} value={constraints} onChange={setConstraints} />
            <input className={`${input} mt-2`} value={extraC} onChange={(e) => setExtraC(e.target.value)} placeholder="anything else? (comma separated)" />
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={running}
        className="mt-5 w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 py-3 text-sm font-semibold text-white shadow-md transition hover:opacity-95 disabled:opacity-60"
      >
        {running ? "Planning your Saturday…" : "Plan my Saturday ✨"}
      </button>
    </form>
  );
}
