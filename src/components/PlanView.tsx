"use client";

import {
  ArrowUpRight,
  Building2,
  CalendarDays,
  Car,
  CircleSlash,
  Clock,
  CloudSun,
  Footprints,
  Info,
  Leaf,
  LifeBuoy,
  Lightbulb,
  MapPin,
  RotateCcw,
  Route,
  TriangleAlert,
  Trees,
  Umbrella,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { mapsUrl } from "@/lib/geo";
import type { Place, RenderedPlan } from "@/lib/types";
import type { MapPoint } from "./RouteMap";

// Leaflet needs `window`, so the map is client-only and code-split.
const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="h-64 w-full animate-pulse bg-slate-100 sm:h-72" />,
});

const SOURCE: Record<Place["source"], { label: string; cls: string; title: string }> = {
  osm_live: { label: "Live · OpenStreetMap", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", title: "Fetched live from OpenStreetMap; price and crowd level are estimates" },
  curated: { label: "Curated", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200", title: "Hand-checked place with a known price range and hours" },
  generic: { label: "Generic suggestion", cls: "bg-slate-100 text-slate-600 ring-slate-200", title: "No specific venue matched; a generic suggestion" },
};
const CROWD: Record<string, { label: string; dot: string }> = {
  low: { label: "Quiet", dot: "bg-emerald-500" },
  medium: { label: "Moderate", dot: "bg-amber-500" },
  high: { label: "Busy", dot: "bg-rose-500" },
};
const VEG: Record<string, string> = { pure_veg: "Pure vegetarian", veg_friendly: "Vegetarian options", unknown: "Veg options unverified", non_veg: "Non-vegetarian" };

function Badge({ children, cls = "bg-slate-50 text-slate-600 ring-slate-200", title }: { children: React.ReactNode; cls?: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cls}`}>
      {children}
    </span>
  );
}

function SectionTitle({ Icon, children }: { Icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </p>
  );
}

export function PlanView({ plan, onRestart }: { plan: RenderedPlan; onRestart: () => void }) {
  const v = plan.validation;
  const p = plan.preferences;
  const c = v.cost;
  const pct = Math.min(100, Math.round((c.total / Math.max(c.budget, 1)) * 100));
  const tl = new Map(v.timeline.map((t) => [t.place_id, t]));
  const points = useMemo<MapPoint[]>(
    () => [
      { lat: p.lat, lon: p.lon, label: "S", name: p.area ? `Start: ${p.area}` : `Start: ${p.city} centre`, kind: "start" },
      ...plan.stops.flatMap((s, i): MapPoint[] => {
        const place = plan.places[s.place_id];
        return place ? [{ lat: place.lat, lon: place.lon, label: String(i + 1), name: place.name, kind: place.kind, time: s.start_time }] : [];
      }),
    ],
    [plan, p],
  );
  const date = new Date(p.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-lg shadow-slate-900/5">
      {plan.generated_by === "rules_fallback" && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-xs text-amber-900">
          <LifeBuoy className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          The AI model was unavailable (free-tier limit or outage), so the rule-based planner built this from the same real data and checks.
        </div>
      )}

      {/* Header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-800 px-6 py-6 text-white">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-violet-500/30 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-20 left-10 h-48 w-48 rounded-full bg-amber-400/20 blur-3xl" aria-hidden />
        <p className="relative flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-amber-300">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          {date} · {p.city}
          {p.area ? ` · ${p.area}` : ""}
        </p>
        <h2 className="relative mt-2 text-2xl font-bold leading-tight tracking-tight sm:text-[1.7rem]">{plan.title}</h2>
        <p className="relative mt-2 max-w-2xl text-sm leading-relaxed text-indigo-100">{plan.summary}</p>
        <div className="relative mt-4 flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
            <Clock className="h-3.5 w-3.5 text-amber-300" aria-hidden />
            {p.start_time}–{p.end_time}
          </span>
          {plan.weather && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
              <CloudSun className="h-3.5 w-3.5 text-amber-300" aria-hidden />
              {plan.weather.summary.split(".")[0]}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
            <Users className="h-3.5 w-3.5 text-amber-300" aria-hidden />
            {p.party_size} {p.party_size === 1 ? "person" : "people"}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
            <Zap className="h-3.5 w-3.5 text-amber-300" aria-hidden />
            <span className="capitalize">{p.energy}</span> energy
          </span>
        </div>
      </div>

      {/* Budget */}
      <div className="border-b border-slate-100 px-6 py-4">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900">
            <Wallet className="h-4 w-4 text-indigo-600" aria-hidden />
            Estimated total {c.currency}
            {c.total.toLocaleString()}
            <span className="font-normal text-slate-400">
              of {c.currency}
              {c.budget.toLocaleString()}
            </span>
          </span>
          <span className={`shrink-0 text-xs font-semibold ${c.remaining >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {c.remaining >= 0 ? `${c.currency}${c.remaining.toLocaleString()} left` : `${c.currency}${(-c.remaining).toLocaleString()} over`}
          </span>
        </div>
        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${pct > 100 ? "bg-rose-500" : pct > 90 ? "bg-amber-500" : "bg-gradient-to-r from-indigo-500 to-violet-500"}`}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Places {c.currency}
          {c.stops_total} · travel {c.currency}
          {c.travel_total} including the ride home · 5% buffer {c.currency}
          {c.buffer}. Prices for live places are category estimates.
        </p>
        {plan.budget_note && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-900">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {plan.budget_note}
          </p>
        )}
      </div>

      {/* Map */}
      <div className="border-b border-slate-100">
        <RouteMap points={points} />
        <p className="flex items-center gap-1.5 px-6 py-2 text-[11px] text-slate-400">
          <Route className="h-3 w-3 shrink-0" aria-hidden />S marks the start. Pins match the timeline; lines are straight connections, not driving routes.
        </p>
      </div>

      {/* Timeline */}
      <ol className="px-6 py-5">
        {plan.stops.map((s, i) => {
          const place = plan.places[s.place_id];
          const t = tl.get(s.place_id);
          if (!place) return null;
          const src = SOURCE[place.source];
          const crowd = CROWD[t?.crowd_at_time ?? place.crowd_base];
          return (
            <li key={s.place_id} className="relative pb-7 pl-20 last:pb-0">
              <div className="absolute left-0 top-0 w-12 text-right">
                <p className="text-sm font-bold tabular-nums text-slate-900">{s.start_time}</p>
                <p className="text-[11px] text-slate-400">{s.duration_min} min</p>
              </div>
              <span
                className={`absolute left-[3.6rem] top-0 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white ring-4 ${
                  place.kind === "food" ? "bg-amber-500 ring-amber-100" : "bg-indigo-600 ring-indigo-100"
                }`}
              >
                {i + 1}
              </span>
              {i < plan.stops.length - 1 && <span className="absolute bottom-0 left-[4.35rem] top-7 w-px bg-slate-200" aria-hidden />}
              <div className="ml-1">
                {t && t.travel_from_prev_min > 0 && (
                  <p className="mb-1 flex items-center gap-1 text-[11px] text-slate-400">
                    {t.travel_mode === "walk" ? <Footprints className="h-3 w-3" aria-hidden /> : <Car className="h-3 w-3" aria-hidden />}
                    {t.travel_from_prev_min} min {t.travel_mode === "walk" ? "walk" : "by auto/cab"}
                    {i === 0 ? " from start" : ""} · {t.travel_km} km
                    {t.travel_cost ? ` · about ${p.currency}${t.travel_cost}` : ""}
                  </p>
                )}
                <a
                  href={mapsUrl(place.lat, place.lon)}
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-center gap-1 text-base font-semibold text-slate-900 hover:text-indigo-700"
                >
                  {place.name}
                  <ArrowUpRight className="h-4 w-4 text-slate-400 transition group-hover:text-indigo-600" aria-hidden />
                </a>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge cls={src.cls} title={src.title}>
                    {src.label}
                  </Badge>
                  <Badge>
                    {place.est_cost_per_person === 0
                      ? "Free"
                      : `${place.cost_confidence === "heuristic" ? "≈ " : ""}${p.currency}${place.est_cost_per_person} per person`}
                  </Badge>
                  <Badge>
                    <span className={`h-1.5 w-1.5 rounded-full ${crowd.dot}`} aria-hidden />
                    {crowd.label} at that time
                  </Badge>
                  <Badge>
                    {place.indoor ? <Building2 className="h-3 w-3" aria-hidden /> : <Trees className="h-3 w-3" aria-hidden />}
                    {place.indoor ? "Indoor" : "Outdoor"}
                  </Badge>
                  {place.veg && (
                    <Badge cls={place.veg === "pure_veg" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : undefined}>
                      <Leaf className="h-3 w-3" aria-hidden />
                      {VEG[place.veg]}
                    </Badge>
                  )}
                  {place.hours && (
                    <Badge>
                      <Clock className="h-3 w-3" aria-hidden />
                      {place.hours}
                    </Badge>
                  )}
                </div>
                <p className="mt-2.5 text-sm leading-relaxed text-slate-800">{s.what_to_do}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  <span className="font-semibold text-slate-800">Why it fits: </span>
                  {s.why_it_fits}
                </p>
                {s.tradeoff && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>
                      <span className="font-semibold">Trade-off: </span>
                      {s.tradeoff}
                    </span>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Details */}
      <div className="space-y-4 border-t border-slate-100 px-6 py-5 text-sm">
        <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 p-4 ring-1 ring-inset ring-indigo-100">
          <SectionTitle Icon={Umbrella}>Plan B · {plan.plan_b.trigger}</SectionTitle>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-800">{plan.plan_b.suggestion}</p>
        </div>
        {plan.left_out && plan.left_out.length > 0 && (
          <div>
            <SectionTitle Icon={CircleSlash}>Not included</SectionTitle>
            <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-slate-600">
              {plan.left_out.map((x) => (
                <li key={x.interest}>
                  <span className="font-semibold capitalize text-slate-800">{x.interest}:</span> {x.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        {v.warnings.length > 0 && (
          <div>
            <SectionTitle Icon={TriangleAlert}>Worth knowing</SectionTitle>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs leading-relaxed text-slate-600 marker:text-slate-300">
              {v.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {plan.tips.length > 0 && (
          <div>
            <SectionTitle Icon={Lightbulb}>Tips</SectionTitle>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs leading-relaxed text-slate-600 marker:text-slate-300">
              {plan.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        )}
        {plan.assumptions.length > 0 && (
          <div>
            <SectionTitle Icon={Info}>Assumptions</SectionTitle>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs leading-relaxed text-slate-500 marker:text-slate-300">
              {plan.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/80 px-6 py-3.5">
        <a
          href={plan.route_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-700"
        >
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          Open route in Google Maps
        </a>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-400 hover:text-indigo-700"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Start over
        </button>
        <span className="ml-auto text-[11px] text-slate-400">
          {plan.generated_by === "agent" ? `Planned by ${plan.model ?? "LLM"} on Groq` : "Rule-based fallback"} · {v.violations.length} validator violations
        </span>
      </div>
    </section>
  );
}
