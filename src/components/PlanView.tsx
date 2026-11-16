"use client";

import { mapsUrl } from "@/lib/geo";
import type { Place, RenderedPlan } from "@/lib/types";

const SOURCE: Record<Place["source"], { label: string; cls: string; title: string }> = {
  osm_live: { label: "Live · OpenStreetMap", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", title: "Fetched live from OpenStreetMap; price and crowd are estimates" },
  curated: { label: "Curated", cls: "bg-sky-50 text-sky-700 border-sky-200", title: "Hand-checked place with known price range and hours" },
  generic: { label: "Generic fallback", cls: "bg-stone-100 text-stone-600 border-stone-200", title: "No specific venue matched; a generic suggestion" },
};
const CROWD: Record<string, string> = { low: "🟢 quiet", medium: "🟡 moderate", high: "🔴 busy" };
const VEG: Record<string, string> = { pure_veg: "🥬 pure veg", veg_friendly: "🥗 veg options", unknown: "❔ veg unverified", non_veg: "🍗 non-veg" };

function Badge({ children, cls = "bg-stone-50 text-stone-600 border-stone-200", title }: { children: React.ReactNode; cls?: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

export function PlanView({ plan, onRestart }: { plan: RenderedPlan; onRestart: () => void }) {
  const v = plan.validation;
  const p = plan.preferences;
  const c = v.cost;
  const pct = Math.min(100, Math.round((c.total / Math.max(c.budget, 1)) * 100));
  const tl = new Map(v.timeline.map((t) => [t.place_id, t]));

  return (
    <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      {plan.generated_by === "rules_fallback" && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800">
          🛟 The AI model was unavailable (free-tier limit or outage), so this plan was built by the rule-based fallback planner from the same real data and checks.
        </div>
      )}
      <div className="bg-gradient-to-br from-orange-500 to-rose-500 px-5 py-5 text-white">
        <p className="text-xs uppercase tracking-wide opacity-80">
          Saturday {new Date(p.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {p.city}
          {p.area ? ` · ${p.area}` : ""}
        </p>
        <h2 className="mt-1 text-2xl font-bold leading-tight">{plan.title}</h2>
        <p className="mt-2 text-sm opacity-95">{plan.summary}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-white/20 px-2.5 py-1">
            🕓 {p.start_time}–{p.end_time}
          </span>
          {plan.weather && <span className="rounded-full bg-white/20 px-2.5 py-1">🌦️ {plan.weather.summary.split(".")[0]}</span>}
          <span className="rounded-full bg-white/20 px-2.5 py-1">
            👥 {p.party_size} · ⚡ {p.energy} energy
          </span>
        </div>
      </div>

      {/* Budget */}
      <div className="border-b border-stone-100 px-5 py-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium text-stone-800">
            Est. total {c.currency}
            {c.total.toLocaleString()} <span className="text-stone-400">of {c.currency}{c.budget.toLocaleString()}</span>
          </span>
          <span className={`text-xs font-medium ${c.remaining >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {c.remaining >= 0 ? `${c.currency}${c.remaining.toLocaleString()} left` : `${c.currency}${(-c.remaining).toLocaleString()} over`}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
          <div className={`h-full ${pct > 100 ? "bg-rose-500" : pct > 90 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-[11px] text-stone-500">
          Places {c.currency}
          {c.stops_total} · travel {c.currency}
          {c.travel_total} (incl. ride home) · 5% buffer {c.currency}
          {c.buffer}. Prices for live places are category estimates.
        </p>
      </div>

      {/* Timeline */}
      <ol className="px-5 py-4">
        {plan.stops.map((s, i) => {
          const place = plan.places[s.place_id];
          const t = tl.get(s.place_id);
          if (!place) return null;
          const src = SOURCE[place.source];
          return (
            <li key={s.place_id} className="relative pb-5 pl-16 last:pb-0">
              <div className="absolute left-0 top-0 w-12 text-right">
                <p className="text-sm font-bold text-stone-900">{s.start_time}</p>
                <p className="text-[10px] text-stone-400">{s.duration_min} min</p>
              </div>
              <span className="absolute left-[3.55rem] top-1.5 h-2.5 w-2.5 rounded-full bg-orange-500 ring-4 ring-orange-100" />
              {i < plan.stops.length - 1 && <span className="absolute bottom-0 left-[3.85rem] top-5 w-px bg-stone-200" />}
              <div className="ml-3">
                {t && t.travel_from_prev_min > 0 && (
                  <p className="mb-1 text-[11px] text-stone-400">
                    {t.travel_mode === "walk" ? "🚶" : "🛺"} {t.travel_from_prev_min} min {i === 0 ? "from start" : ""} · {t.travel_km} km
                    {t.travel_cost ? ` · ~${p.currency}${t.travel_cost}` : ""}
                  </p>
                )}
                <a href={mapsUrl(place.lat, place.lon)} target="_blank" rel="noreferrer" className="text-base font-semibold text-stone-900 hover:text-orange-600">
                  {place.name} ↗
                </a>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge cls={src.cls} title={src.title}>
                    {src.label}
                  </Badge>
                  <Badge>
                    {place.est_cost_per_person === 0 ? "free" : `${place.cost_confidence === "heuristic" ? "~" : ""}${p.currency}${place.est_cost_per_person}/person`}
                  </Badge>
                  <Badge>{CROWD[t?.crowd_at_time ?? place.crowd_base]} then</Badge>
                  <Badge>{place.indoor ? "🏠 indoor" : "🌳 outdoor"}</Badge>
                  {place.veg && <Badge>{VEG[place.veg]}</Badge>}
                  {place.hours && <Badge>⏰ {place.hours}</Badge>}
                </div>
                <p className="mt-2 text-sm text-stone-800">{s.what_to_do}</p>
                <p className="mt-1 text-sm text-stone-600">
                  <span className="font-medium text-stone-700">Why it fits: </span>
                  {s.why_it_fits}
                </p>
                {s.tradeoff && (
                  <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                    <span className="font-semibold">Trade-off: </span>
                    {s.tradeoff}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="space-y-3 border-t border-stone-100 px-5 py-4 text-sm">
        <div className="rounded-xl bg-sky-50 p-3">
          <p className="text-xs font-semibold text-sky-900">Plan B · {plan.plan_b.trigger}</p>
          <p className="mt-0.5 text-sm text-sky-900/90">{plan.plan_b.suggestion}</p>
        </div>
        {v.warnings.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-stone-700">Heads-up (checked by the validator)</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-stone-600">
              {v.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {plan.tips.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-stone-700">Tips</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-stone-600">
              {plan.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        )}
        {plan.assumptions.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-stone-700">Assumptions I made</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-stone-500">
              {plan.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 bg-stone-50 px-5 py-3">
        <a href={plan.route_url} target="_blank" rel="noreferrer" className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white hover:bg-stone-700">
          Open full route in Google Maps
        </a>
        <button type="button" onClick={onRestart} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 hover:border-orange-400">
          Plan another
        </button>
        <span className="ml-auto text-[10px] text-stone-400">
          {plan.generated_by === "agent" ? `Planned by ${plan.model ?? "LLM"} via Groq` : "Rule-based fallback"} · validator: {v.violations.length} violations
        </span>
      </div>
    </section>
  );
}
