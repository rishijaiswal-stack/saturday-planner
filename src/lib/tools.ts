// The agent's tools. Every function here is deterministic code - no LLM.
// Principle: the LLM decides (interpretation, selection, trade-offs, wording);
// code computes (geocoding, search, ranking, money, time, constraint checks).

import { CITY_CENTRES, curatedFor, genericOptions } from "./data/curated";
import {
  crowdAt,
  currencyFor,
  estimateLeg,
  fromMin,
  haversineKm,
  round1,
  toMin,
  upcomingSaturday,
  withinHours,
} from "./geo";
import { canonicalInterest, geocode, liveSearch } from "./providers/places";
import { getWeather, rainAt } from "./providers/weather";
import type { Energy, Place, PlanStopInput, Preferences, TimelineEntry, ValidationResult, WeatherSummary } from "./types";

// ---------------------------------------------------------------------------
// parse_preferences: normalise raw (LLM- or form-extracted) fields + geocode.
// ---------------------------------------------------------------------------
export interface RawPrefs {
  city?: string;
  area?: string;
  budget?: number | null;
  party_size?: number | null;
  available_minutes?: number | null;
  start_time?: string | null;
  mood?: string;
  energy?: Energy;
  interests?: string[];
  constraints?: string[];
  dietary?: "vegetarian" | "vegan" | "jain" | "none";
  avoid_crowds?: boolean;
  assumptions?: string[];
}

export type ParseOutcome =
  | { ok: true; prefs: Preferences }
  | { ok: false; reason: string; question: string; options?: string[] };

export async function parsePreferences(raw: RawPrefs): Promise<ParseOutcome> {
  const assumptions = [...(raw.assumptions ?? [])];
  const cityIn = (raw.city ?? "").trim();
  if (!cityIn) {
    return { ok: false, reason: "No city given", question: "Which city are you spending Saturday in?", options: ["Bangalore", "Mumbai", "Delhi"] };
  }

  // Geocode: live (Photon) first, known-city table as fallback.
  let lat: number, lon: number, cc: string, cityName = cityIn;
  const known = CITY_CENTRES[cityIn.toLowerCase()];
  if (known) {
    // Known city: no network round trip needed.
    ({ lat, lon, cc } = known);
    cityName = known.name;
  } else {
    try {
      const g = await geocode(cityIn);
      if (!g) {
        return { ok: false, reason: `Could not find "${cityIn}"`, question: `I couldn't find "${cityIn}" on the map. Which city did you mean?` };
      }
      ({ lat, lon } = g);
      cc = g.country_code || "us";
    } catch {
      return { ok: false, reason: "Geocoder unavailable and city not in offline table", question: `Map lookup is down and I don't know "${cityIn}" offline. Could you pick a nearby major city?`, options: ["Bangalore", "Mumbai", "Delhi"] };
    }
  }

  // Optional neighbourhood anchor ("Indiranagar") so plans start near the user.
  let area = raw.area?.trim() || undefined;
  if (area) {
    try {
      const g = await geocode(`${area}, ${cityName}`, { lat, lon });
      if (g && haversineKm(g.lat, g.lon, lat, lon) < 40) {
        lat = g.lat;
        lon = g.lon;
      } else {
        assumptions.push(`Couldn't locate "${area}"; starting from the city centre.`);
        area = undefined;
      }
    } catch {
      area = undefined;
    }
  }

  const cur = currencyFor(cc);
  let budget = raw.budget ?? null;
  if (budget == null || Number.isNaN(budget)) {
    budget = Math.round(1500 * cur.factor);
    assumptions.push(`No budget given; assuming a moderate ${cur.symbol}${budget}.`);
  }
  budget = Math.max(0, budget);

  let minutes = raw.available_minutes ?? null;
  if (!minutes || minutes <= 0) {
    minutes = 240;
    assumptions.push("No time window given; assuming 4 hours.");
  }
  minutes = Math.min(Math.max(minutes, 60), 720);

  const party = Math.min(Math.max(Math.round(raw.party_size ?? 1), 1), 12);
  const energy: Energy = raw.energy ?? "medium";

  // Start time: user's, else mood-based default. Tired -> late afternoon start
  // (cooler, golden hour, no early alarm).
  let start = raw.start_time && !Number.isNaN(toMin(raw.start_time)) ? toMin(raw.start_time) : NaN;
  if (Number.isNaN(start)) {
    start = energy === "low" ? 16 * 60 : energy === "high" ? 10 * 60 : 14 * 60;
    if (start + minutes > 22 * 60) start = Math.max(8 * 60, 22 * 60 - minutes);
    assumptions.push(`Start time not given; starting at ${fromMin(start)}${energy === "low" ? " so you can rest first" : ""}.`);
  }
  const end = Math.min(start + minutes, 23 * 60 + 59);

  const constraints = raw.constraints ?? [];
  const cText = constraints.join(" ").toLowerCase();
  const dietary =
    raw.dietary && raw.dietary !== "none"
      ? raw.dietary
      : /jain/.test(cText)
        ? "jain"
        : /vegan/.test(cText)
          ? "vegan"
          : /veg/.test(cText)
            ? "vegetarian"
            : "none";
  const avoid = raw.avoid_crowds ?? /crowd|quiet|calm|peaceful|busy/.test(cText);

  return {
    ok: true,
    prefs: {
      city: cityName,
      area,
      country_code: cc,
      currency: cur.symbol,
      lat,
      lon,
      budget,
      party_size: party,
      available_minutes: end - start,
      start_time: fromMin(start),
      end_time: fromMin(end),
      mood: raw.mood?.trim() || "relaxed",
      energy,
      interests: (raw.interests ?? []).map((i) => i.trim()).filter(Boolean).slice(0, 6),
      constraints,
      dietary,
      avoid_crowds: avoid,
      date: upcomingSaturday(),
      assumptions,
    },
  };
}

// ---------------------------------------------------------------------------
// Registry: every place the agent has *seen*. The validator rejects any
// place_id not in here -> the model cannot hallucinate venues into a plan.
// ---------------------------------------------------------------------------
export class Registry {
  private map = new Map<string, Place>();
  add(places: Place[]) {
    places.forEach((p) => this.map.set(p.id, p));
  }
  get(id: string) {
    return this.map.get(id);
  }
  /** Map a model-written id back to a real one: exact, missing prefix ("blr-green"), or exact name. */
  resolve(id: string): string | null {
    if (this.map.has(id)) return id;
    const t = id.trim().toLowerCase();
    for (const [k, p] of this.map) {
      if (k.toLowerCase().endsWith(`:${t}`) || k.toLowerCase().split(":").slice(1).join(":") === t) return k;
      if (p.name.toLowerCase() === t) return k;
    }
    return null;
  }
  has(id: string) {
    return this.map.has(id);
  }
}

// ---------------------------------------------------------------------------
// get_activity_options / get_food_options: curated + live OSM, widened radius,
// then ranked against the user's preferences. Ranking in code keeps the LLM
// context small (free-tier token limits) and makes "why this candidate" explicit.
// ---------------------------------------------------------------------------
function withDistance(p: Place, prefs: Preferences): Place {
  return { ...p, distance_km: round1(haversineKm(prefs.lat, prefs.lon, p.lat, p.lon)) };
}

function matchesInterest(p: Place, interest: string): boolean {
  const key = canonicalInterest(interest);
  const words: Record<string, RegExp> = {
    walk: /walk|park|garden|lake|street|promenade/,
    nature: /park|garden|lake|nature/,
    music: /music|concert|jazz|rock|live|arts_centre|bar|pub/,
    art: /art|gallery|museum/,
    museum: /museum/,
    history: /history|palace|fort|monument/,
    books: /book/,
    shopping: /mall|market|shop|street/,
    movies: /cinema|movie/,
    theatre: /theatre/,
    games: /game|bowling|arcade/,
    coffee: /cafe|coffee/,
  };
  const re = words[key] ?? new RegExp(key.replace(/[^a-z]/g, ""), "i");
  return re.test(`${p.category} ${p.name}`.toLowerCase());
}

const ENERGY_RANK: Record<Energy, number> = { low: 0, medium: 1, high: 2 };

function scorePlace(p: Place, prefs: Preferences, weather: WeatherSummary | null): number {
  let s = 0;
  if (p.source === "curated") s += 1.5;
  if (p.source === "generic") s -= 4;
  s -= Math.min(p.distance_km ?? 0, 30) * 0.15;
  if (prefs.avoid_crowds) s -= p.crowd_base === "high" ? 2 : p.crowd_base === "medium" ? 0.4 : -0.4;
  const gap = ENERGY_RANK[p.energy] - ENERGY_RANK[prefs.energy];
  if (gap > 0) s -= gap * 1.2;
  if (!p.indoor && (weather?.max_rain_prob ?? 0) >= 60) s -= 1.5;
  const share = (p.est_cost_per_person * prefs.party_size) / Math.max(prefs.budget, 1);
  if (share > 0.6) s -= 2;
  if (p.kind === "food" && prefs.dietary !== "none") {
    s += p.veg === "pure_veg" ? 1.5 : p.veg === "veg_friendly" ? 0.5 : p.veg === "unknown" ? -1.5 : -10;
  }
  return s;
}

export interface OptionsResult {
  places: Place[];
  live_count: number;
  curated_count: number;
  radius_km: number;
  provider_failures: number;
  providers: string[];
  note?: string;
}

// Providers return nearest-first (proximity bias), so one wide query beats
// re-querying at growing radii; widen once only if the city is sparse.
const RADII = [12, 30];

export async function getActivityOptions(
  prefs: Preferences,
  weather: WeatherSummary | null,
  registry: Registry,
  limit = 10,
): Promise<OptionsResult> {
  const cur = currencyFor(prefs.country_code);
  const interests = prefs.interests.filter((i) => !/^(food|eat|eating|dining|restaurants?)$/i.test(i.trim()));
  const effective = interests.length ? interests : ["walk", "art"];
  const curated = curatedFor(prefs.city).filter((p) => p.kind === "activity").map((p) => withDistance(p, prefs));

  let live: Place[] = [];
  let failures = 0;
  let radius = RADII[0];
  const providers = new Set<string>();
  for (const r of RADII) {
    radius = r;
    const results = await Promise.all(
      effective.map(async (interest) => {
        const res = await liveSearch({ kind: "activity", interest, anchor: prefs, radiusKm: r, factor: cur.factor, dietary: prefs.dietary });
        failures += res.failures;
        providers.add(res.provider);
        return res.places.map((p) => ({ ...p, interest }));
      }),
    );
    live = results.flat();
    const near = curated.filter((p) => (p.distance_km ?? 99) <= r);
    if (live.length + near.length >= 6) break;
  }

  // Tag curated with the interest they serve; drop curated outside radius.
  const pool = new Map<string, Place>();
  for (const p of curated) {
    if ((p.distance_km ?? 99) > radius) continue;
    const hit = effective.find((i) => matchesInterest(p, i));
    // No stated interests: well-known curated places are better defaults than
    // whatever generic OSM search returns (statues, unnamed parks).
    if (hit) pool.set(p.id, { ...p, interest: hit });
    else if (!interests.length) pool.set(p.id, { ...p, interest: "popular pick" });
  }
  for (const p of live) {
    // Skip live duplicates of curated places (same name nearby).
    const dup = [...pool.values()].some(
      (c) => c.name.toLowerCase().includes(p.name.toLowerCase().slice(0, 10)) && haversineKm(c.lat, c.lon, p.lat, p.lon) < 0.6,
    );
    if (!dup && !pool.has(p.id)) pool.set(p.id, p);
  }

  // Round-robin by interest so every interest is represented, best first.
  const byInterest = new Map<string, Place[]>();
  for (const p of pool.values()) {
    const k = p.interest ?? "other";
    byInterest.set(k, [...(byInterest.get(k) ?? []), p]);
  }
  const ranked = [...byInterest.values()].map((list) =>
    list.sort((a, b) => scorePlace(b, prefs, weather) - scorePlace(a, prefs, weather)),
  );
  const out: Place[] = [];
  for (let i = 0; out.length < limit && ranked.some((l) => l[i]); i++) {
    for (const l of ranked) if (l[i] && out.length < limit) out.push(l[i]);
  }

  let note: string | undefined;
  if (out.length < 2) {
    const gen = genericOptions(prefs.lat, prefs.lon, cur.factor).filter((g) => g.kind === "activity");
    out.push(...gen);
    note = "Very few real venues matched; generic fallback options added (marked gen:*).";
  }
  registry.add(out);
  return {
    places: out,
    live_count: out.filter((p) => p.source === "osm_live").length,
    curated_count: out.filter((p) => p.source === "curated").length,
    radius_km: radius,
    provider_failures: failures,
    providers: [...providers].filter((p) => p !== "none"),
    note,
  };
}

export async function getFoodOptions(
  prefs: Preferences,
  weather: WeatherSummary | null,
  registry: Registry,
  limit = 8,
): Promise<OptionsResult> {
  const cur = currencyFor(prefs.country_code);
  const curated = curatedFor(prefs.city).filter((p) => p.kind === "food").map((p) => withDistance(p, prefs));
  let live: Place[] = [];
  let failures = 0;
  let radius = RADII[0];
  const providers = new Set<string>();
  for (const r of RADII) {
    radius = r;
    const res = await liveSearch({ kind: "food", interest: "food", anchor: prefs, radiusKm: r, factor: cur.factor, dietary: prefs.dietary });
    failures += res.failures;
    providers.add(res.provider);
    live = res.places;
    const ok = [...live, ...curated.filter((p) => (p.distance_km ?? 99) <= r)].filter(
      (p) => prefs.dietary === "none" || p.veg !== "non_veg",
    );
    if (ok.length >= 5) break;
  }
  const pool = [...curated.filter((p) => (p.distance_km ?? 99) <= radius), ...live].filter(
    (p) => prefs.dietary === "none" || p.veg !== "non_veg",
  );
  const ranked = pool.sort((a, b) => scorePlace(b, prefs, weather) - scorePlace(a, prefs, weather)).slice(0, limit);

  let note: string | undefined;
  if (ranked.length < 2) {
    ranked.push(...genericOptions(prefs.lat, prefs.lon, cur.factor).filter((g) => g.kind === "food"));
    note = "No suitable food venues matched; generic fallback options added (marked gen:*).";
  }
  registry.add(ranked);
  return {
    places: ranked,
    live_count: ranked.filter((p) => p.source === "osm_live").length,
    curated_count: ranked.filter((p) => p.source === "curated").length,
    radius_km: radius,
    provider_failures: failures,
    providers: [...providers].filter((p) => p !== "none"),
    note,
  };
}

// search_places: targeted lookup the agent can use when candidates don't cover
// something specific ("jazz", "board game cafe").
export async function searchPlaces(
  prefs: Preferences,
  kind: "activity" | "food",
  query: string,
  registry: Registry,
): Promise<Place[]> {
  const cur = currencyFor(prefs.country_code);
  const q = query.trim().slice(0, 60);
  const res = await liveSearch({ kind, interest: q, freeText: true, anchor: prefs, radiusKm: 15, factor: cur.factor, dietary: prefs.dietary });
  const curated = curatedFor(prefs.city)
    .filter((p) => p.kind === kind && `${p.name} ${p.category} ${p.notes}`.toLowerCase().includes(q.toLowerCase()))
    .map((p) => withDistance(p, prefs));
  const all = [...curated, ...res.places.map((p) => ({ ...p, interest: q }))]
    .filter((p) => kind !== "food" || prefs.dietary === "none" || p.veg !== "non_veg")
    .sort((a, b) => scorePlace(b, prefs, null) - scorePlace(a, prefs, null))
    .slice(0, 6);
  registry.add(all);
  return all;
}

export async function weatherFor(prefs: Preferences) {
  return getWeather(prefs.lat, prefs.lon, prefs.date);
}

// ---------------------------------------------------------------------------
// estimate_cost + validate_plan. Deterministic and the single source of truth
// for every number the user sees. The LLM's prose is never trusted for maths.
// ---------------------------------------------------------------------------
export function validatePlan(
  stops: PlanStopInput[],
  prefs: Preferences,
  registry: Registry,
  weather: WeatherSummary | null,
): ValidationResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  const cur = currencyFor(prefs.country_code);
  const timeline: TimelineEntry[] = [];
  const winStart = toMin(prefs.start_time);
  const winEnd = winStart + prefs.available_minutes;

  if (stops.length === 0) violations.push("Plan has no stops.");
  const seen = new Set<string>();
  let prev = { lat: prefs.lat, lon: prefs.lon };
  let prevLeave = winStart;
  let stopsTotal = 0;
  let travelTotal = 0;
  let travelMinutes = 0;
  let unverifiedHours = 0;
  let foodStops = 0;

  stops.forEach((s, i) => {
    const p = registry.get(s.place_id);
    if (!p) {
      violations.push(`Stop ${i + 1}: unknown place_id "${s.place_id}". Only use IDs returned by the option/search tools.`);
      return;
    }
    if (seen.has(p.id)) violations.push(`${p.name} appears twice.`);
    seen.add(p.id);
    if (p.kind === "food") foodStops++;

    const start = toMin(s.start_time);
    const dur = Math.round(s.duration_min);
    if (Number.isNaN(start)) {
      violations.push(`Stop ${i + 1} (${p.name}): start_time "${s.start_time}" is not HH:MM.`);
      return;
    }
    if (dur < 20) violations.push(`${p.name}: ${dur} min is too short to be worthwhile (min 20).`);

    const leg = estimateLeg(prev.lat, prev.lon, p.lat, p.lon, prefs.city, cur);
    const earliest = prevLeave + leg.minutes;
    if (start + 5 < earliest) {
      violations.push(
        `${p.name}: starts ${s.start_time} but earliest arrival is ${fromMin(earliest)} (${leg.minutes} min ${leg.mode} from previous, ${leg.km} km).`,
      );
    }
    if (leg.minutes > 45) warnings.push(`Long ride to ${p.name}: ~${leg.minutes} min.`);

    const open = withinHours(p.hours, start, start + dur);
    if (open === false) violations.push(`${p.name} is likely closed during ${s.start_time}-${fromMin(start + dur)} (hours ${p.hours}).`);
    if (open === null && p.source === "osm_live") unverifiedHours++;

    const crowd = crowdAt(p.crowd_base, p.category, start);
    if (prefs.avoid_crowds && crowd === "high") warnings.push(`${p.name} is usually crowded at ${s.start_time} on Saturdays (you asked to avoid crowds).`);

    if (p.kind === "food" && prefs.dietary !== "none") {
      if (p.veg === "non_veg") violations.push(`${p.name} does not fit your ${prefs.dietary} diet.`);
      else if (p.veg === "unknown") warnings.push(`${p.name}: vegetarian options not verified - check the menu.`);
    }

    if (!p.indoor) {
      const rain = rainAt(weather, start, start + dur);
      if (rain >= 80) violations.push(`${p.name} is outdoors and rain chance is ${rain}% at that time.`);
      else if (rain >= 50) warnings.push(`${p.name} is outdoors; ${rain}% chance of rain then.`);
    }
    if (ENERGY_RANK[p.energy] - ENERGY_RANK[prefs.energy] >= 2) warnings.push(`${p.name} is physically demanding for a low-energy day.`);

    const stopCost = p.est_cost_per_person * prefs.party_size;
    stopsTotal += stopCost;
    travelTotal += leg.cost;
    travelMinutes += leg.minutes;
    timeline.push({
      place_id: p.id,
      name: p.name,
      arrive: fromMin(start),
      leave: fromMin(start + dur),
      travel_from_prev_min: leg.minutes,
      travel_mode: i === 0 ? (leg.mode === "walk" ? "walk" : "auto/cab") : leg.mode,
      travel_km: leg.km,
      travel_cost: leg.cost,
      stop_cost: stopCost,
      crowd_at_time: crowd,
    });
    prev = p;
    prevLeave = start + dur;
  });

  // Window checks (first stop includes travel from the starting point).
  if (timeline.length) {
    const first = toMin(timeline[0].arrive) - timeline[0].travel_from_prev_min;
    if (first < winStart - 15) violations.push(`Plan starts before your window (${prefs.start_time}).`);
    if (prevLeave > winEnd + 10) violations.push(`Plan ends ${fromMin(prevLeave)}, after your window ends at ${prefs.end_time}.`);
    if (prevLeave < winEnd - 75) warnings.push(`Plan ends at ${fromMin(prevLeave)}, leaving ${winEnd - prevLeave} min of your window unused.`);
  }
  // Return trip home: cost counted, time only warned.
  const back = estimateLeg(prev.lat, prev.lon, prefs.lat, prefs.lon, prefs.city, cur);
  if (timeline.length) {
    travelTotal += back.cost;
    if (prevLeave + back.minutes > winEnd + 20) warnings.push(`Getting back takes ~${back.minutes} min, so you'd be home around ${fromMin(prevLeave + back.minutes)}.`);
  }
  if (travelMinutes > prefs.available_minutes * 0.35) warnings.push(`${travelMinutes} min of travel is over a third of your time.`);
  if (unverifiedHours) warnings.push(`${unverifiedHours} live OSM place(s) have no opening hours in the data - confirm before going.`);
  if (prefs.energy === "low" && stops.length > 4) warnings.push("More than 4 stops is a lot for a tired day.");
  if (foodStops === 0 && prefs.interests.some((i) => /food|eat/i.test(i))) warnings.push("You listed food as an interest but the plan has no food stop.");

  const buffer = Math.round((stopsTotal + travelTotal) * 0.05);
  const total = stopsTotal + travelTotal + buffer;
  if (total > prefs.budget * 1.1) violations.push(`Estimated total ${prefs.currency}${total} exceeds budget ${prefs.currency}${prefs.budget} by more than 10%.`);
  else if (total > prefs.budget) warnings.push(`Estimated total ${prefs.currency}${total} is slightly over your ${prefs.currency}${prefs.budget} budget.`);

  return {
    ok: violations.length === 0,
    violations,
    warnings: [...new Set(warnings)],
    timeline,
    cost: {
      stops_total: stopsTotal,
      travel_total: travelTotal,
      buffer,
      total,
      budget: prefs.budget,
      remaining: prefs.budget - total,
      currency: prefs.currency,
    },
    total_minutes: timeline.length ? prevLeave - (toMin(timeline[0].arrive) - timeline[0].travel_from_prev_min) : 0,
  };
}

// schedule_stops: the model chooses WHICH stops, their order and durations;
// code computes WHEN. Each start is moved to max(requested, earliest arrival),
// rounded up to 5 min. This removes the most common LLM planning error
// (underestimating city travel) without an extra LLM round trip.
export function scheduleStops(
  stops: PlanStopInput[],
  prefs: Preferences,
  registry: Registry,
): { stops: PlanStopInput[]; adjustments: string[] } {
  const cur = currencyFor(prefs.country_code);
  const adjustments: string[] = [];
  let prev = { lat: prefs.lat, lon: prefs.lon };
  let prevLeave = toMin(prefs.start_time);
  const out = [...stops]
    .sort((a, b) => (toMin(a.start_time) || 0) - (toMin(b.start_time) || 0))
    .map((s) => {
      const p = registry.get(s.place_id);
      const requested = toMin(s.start_time);
      if (!p || Number.isNaN(requested)) return s; // validator will report it
      const leg = estimateLeg(prev.lat, prev.lon, p.lat, p.lon, prefs.city, cur);
      const earliest = Math.ceil((prevLeave + leg.minutes) / 5) * 5;
      const start = Math.max(requested, earliest);
      if (start !== requested) adjustments.push(`${p.name} ${fromMin(requested)}->${fromMin(start)} (travel ${leg.minutes} min)`);
      prev = p;
      prevLeave = start + Math.round(s.duration_min);
      return { ...s, start_time: fromMin(start) };
    });
  return { stops: out, adjustments };
}

// repair_plan: normalise ids, schedule, and if the model's ORDER breaks hours or
// the window, search the other orders of the same stops (<= 24 for 4 stops) and
// keep the valid one closest to the model's intent. The model picks WHAT; code
// solves WHEN and IN WHAT ORDER (a tiny TSP-with-time-windows).
export function repairPlan(
  input: PlanStopInput[],
  prefs: Preferences,
  registry: Registry,
  weather: WeatherSummary | null,
): { stops: PlanStopInput[]; validation: ValidationResult; notes: string[] } {
  const notes: string[] = [];
  const stops = input.map((s) => {
    const real = registry.resolve(s.place_id);
    if (real && real !== s.place_id) notes.push(`id "${s.place_id}" -> ${real}`);
    return real ? { ...s, place_id: real } : s;
  });
  const first = scheduleStops(stops, prefs, registry);
  notes.push(...first.adjustments.map((a) => `moved ${a}`));
  const v0 = validatePlan(first.stops, prefs, registry, weather);
  const timing = /closed during|after your window|earliest arrival|starts before/;
  if (v0.ok || stops.length > 5 || !v0.violations.every((x) => timing.test(x))) {
    return { stops: first.stops, validation: v0, notes };
  }
  const ordered = [...stops].sort((a, b) => (toMin(a.start_time) || 0) - (toMin(b.start_time) || 0));
  const perms = (arr: PlanStopInput[]): PlanStopInput[][] =>
    arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map((r) => [x, ...r]));
  const displacement = (p: PlanStopInput[]) => p.reduce((d, s, i) => d + Math.abs(ordered.indexOf(s) - i), 0);
  const candidates = perms(ordered).sort((a, b) => displacement(a) - displacement(b));
  for (const order of candidates) {
    const fixed = rescheduleInOrder(order, prefs, registry);
    const v = validatePlan(fixed, prefs, registry, weather);
    if (v.ok) {
      notes.push(`re-ordered stops to fit opening hours/window: ${fixed.map((s) => registry.get(s.place_id)?.name).join(" -> ")}`);
      return { stops: fixed, validation: v, notes };
    }
  }
  return { stops: first.stops, validation: v0, notes };
}

function rescheduleInOrder(order: PlanStopInput[], prefs: Preferences, registry: Registry): PlanStopInput[] {
  const cur = currencyFor(prefs.country_code);
  let prev = { lat: prefs.lat, lon: prefs.lon };
  let t = toMin(prefs.start_time);
  return order.map((s) => {
    const p = registry.get(s.place_id);
    if (!p) return s;
    const leg = estimateLeg(prev.lat, prev.lon, p.lat, p.lon, prefs.city, cur);
    let start = Math.ceil((t + leg.minutes) / 5) * 5;
    // If the place isn't open yet, wait for opening.
    const open = p.hours ? toMin(p.hours.split("-")[0]) : NaN;
    if (!Number.isNaN(open) && start < open) start = open;
    prev = p;
    t = start + Math.round(s.duration_min);
    return { ...s, start_time: fromMin(start) };
  });
}

// Compact one-line-per-place rendering for the LLM: ~60% fewer tokens than JSON.
export function placeLine(p: Place, currency: string): string {
  const parts = [
    p.id,
    p.name,
    p.category.replace(/\s*\(.*\)/, ""),
    `${p.distance_km ?? "?"}km`,
    `${currency}${p.est_cost_per_person}${p.cost_confidence === "heuristic" ? "~" : ""}/pp`,
    `crowd:${p.crowd_base}`,
    p.indoor ? "indoor" : "outdoor",
    `energy:${p.energy}`,
    `~${p.typical_minutes}min`,
    p.hours ? `hours:${p.hours}` : "hours:?",
  ];
  if (p.veg) parts.push(`veg:${p.veg}`);
  if (p.interest) parts.push(`for:${p.interest}`);
  if (p.notes) parts.push(p.notes.slice(0, 90));
  return parts.join(" | ");
}
