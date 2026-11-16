// Rule-based fallbacks used when the LLM is unavailable (no key, all models
// rate-limited, provider outage). The user still gets a validated plan built
// from the same real data; the UI labels it clearly. Graceful degradation >
// an error screen.

import { currencyFor, estimateLeg, fromMin, toMin } from "./geo";
import type { RawPrefs, Registry } from "./tools";
import { validatePlan } from "./tools";
import type { Energy, FinalPlan, Place, PlanStopInput, Preferences, ValidationResult, WeatherSummary } from "./types";

export interface FormInput {
  city?: string;
  area?: string;
  budget?: number | string;
  available_time?: string;
  start_time?: string;
  party_size?: number | string;
  mood?: string;
  interests?: string[] | string;
  constraints?: string[] | string;
}

const toList = (v: string[] | string | undefined) =>
  (Array.isArray(v) ? v : (v ?? "").split(",")).map((s) => s.trim()).filter(Boolean);

export function parseDuration(text: string | undefined): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const h = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/.exec(t);
  const m = /(\d+)\s*(m|min|mins|minutes)\b/.exec(t);
  if (h || m) return Math.round((h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0));
  if (/whole day|full day|all day/.test(t)) return 600;
  if (/half day|afternoon|evening|morning/.test(t)) return 240;
  const n = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(t);
  return n ? Math.round(Number(n[1]) * 60) : null;
}

/**
 * Explicit clock times in free text ("from 4pm to 10pm", "after 6 pm",
 * "9am", "16:00-20:00"). Clear user signals like these are enforced by code
 * rather than trusted to the model's extraction.
 */
export function parseTimeWindow(text: string): { start?: string; minutes?: number } {
  const t = text.toLowerCase();
  const toMins = (h: string, m: string | undefined, ap: string | undefined) => {
    let hh = Number(h) % 24;
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
    return hh * 60 + Number(m ?? 0);
  };
  const fmt = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  const T = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?`;
  const range = new RegExp(`${T}\\s*(?:to|till|until|and|-|–)\\s*${T}`).exec(t);
  if (range && (range[3] || range[6] || range[2] || range[5])) {
    const endAp = range[6];
    const startAp = range[3] ?? (endAp && Number(range[1]) <= Number(range[4]) ? endAp : undefined);
    const a = toMins(range[1], range[2], startAp);
    let b = toMins(range[4], range[5], endAp);
    if (b <= a) b += 12 * 60; // "4 to 10pm" style
    if (b - a >= 30 && b - a <= 16 * 60) return { start: fmt(a), minutes: b - a };
  }
  const single = new RegExp(`(?:from|after|at|starting(?: at)?|start(?:ing)? at)\\s+${T}`).exec(t);
  if (single && (single[3] || single[2])) return { start: fmt(toMins(single[1], single[2], single[3])) };
  return {};
}

export function energyFromMood(mood: string): Energy {
  const m = mood.toLowerCase();
  if (/tired|lazy|exhaust|sleepy|low|hungover|drained|chill|relax/.test(m)) return "low";
  if (/energetic|pumped|active|adventur|excited|hyper/.test(m)) return "high";
  return "medium";
}

/** Heuristic understanding (no LLM) for form input or simple free text. */
export function rulesUnderstand(form: FormInput | undefined, text: string | undefined): RawPrefs {
  if (form) {
    const mood = form.mood ?? "";
    const budget = form.budget === undefined || form.budget === "" ? null : Number(form.budget);
    return {
      city: form.city,
      area: form.area,
      budget: Number.isFinite(budget) ? budget : null,
      party_size: Number(form.party_size) || 1,
      available_minutes: parseDuration(form.available_time),
      start_time: form.start_time || null,
      mood,
      energy: energyFromMood(mood),
      interests: toList(form.interests),
      constraints: toList(form.constraints),
    };
  }
  const t = (text ?? "").toLowerCase();
  const tw = parseTimeWindow(t);
  const cities = ["bangalore", "bengaluru", "mumbai", "delhi", "new delhi", "pune", "hyderabad", "chennai", "kolkata", "london", "new york", "singapore", "dubai"];
  const city = cities.find((c) => t.includes(c));
  const budget = /(?:₹|rs\.?|inr|budget(?: of| is)?)\s*(\d[\d,]*)/.exec(t)?.[1]?.replace(/,/g, "");
  const interests = ["food", "music", "walks", "art", "museum", "books", "coffee", "movies", "history", "shopping", "nature"].filter((k) =>
    t.includes(k.replace(/s$/, "")),
  );
  const constraints = [/veg/.test(t) ? "vegetarian" : "", /crowd|quiet|calm/.test(t) ? "avoid crowded places" : ""].filter(Boolean);
  return {
    city,
    budget: budget ? Number(budget) : null,
    available_minutes: tw.minutes ?? parseDuration(t),
    start_time: tw.start ?? null,
    mood: text ?? "",
    energy: energyFromMood(t),
    interests,
    constraints,
  };
}

/** Greedy deterministic planner over the same ranked candidates. */
export function rulesPlan(
  prefs: Preferences,
  activities: Place[],
  foods: Place[],
  weather: WeatherSummary | null,
  registry: Registry,
): { plan: FinalPlan; stops: PlanStopInput[]; validation: ValidationResult } {
  const cur = currencyFor(prefs.country_code);
  const rainy = (weather?.max_rain_prob ?? 0) >= 60;
  const acts = activities.filter((a) => !(rainy && !a.indoor));
  const pickActs: Place[] = [];
  if (acts[0] ?? activities[0]) pickActs.push(acts[0] ?? activities[0]);
  const second = acts.find((a) => a.id !== pickActs[0]?.id && a.interest !== pickActs[0]?.interest);
  if (second && prefs.available_minutes >= 210 && prefs.energy !== "low") pickActs.push(second);
  else if (second && prefs.available_minutes >= 240) pickActs.push(second);

  const anchor = pickActs[pickActs.length - 1] ?? { lat: prefs.lat, lon: prefs.lon };
  const food = [...foods]
    .slice(0, 5)
    .sort((a, b) => estimateLeg(anchor.lat, anchor.lon, a.lat, a.lon, prefs.city, cur).minutes - estimateLeg(anchor.lat, anchor.lon, b.lat, b.lon, prefs.city, cur).minutes)[0];

  const start = toMin(prefs.start_time);
  const lunchInWindow = start <= 12 * 60 + 30 && start + prefs.available_minutes >= 14 * 60;
  let order: Place[] = food
    ? lunchInWindow
      ? [pickActs[0], food, ...pickActs.slice(1)].filter(Boolean)
      : [...pickActs, food]
    : pickActs;

  const build = (seq: Place[]): PlanStopInput[] => {
    const travel: number[] = [];
    let prev = { lat: prefs.lat, lon: prefs.lon };
    for (const p of seq) {
      travel.push(estimateLeg(prev.lat, prev.lon, p.lat, p.lon, prefs.city, cur).minutes);
      prev = p;
    }
    const free = prefs.available_minutes - travel.reduce((a, b) => a + b, 0) - 10;
    const typical = seq.reduce((a, p) => a + p.typical_minutes, 0);
    let t = start;
    return seq.map((p, i) => {
      t += travel[i];
      const dur = Math.max(30, Math.min(Math.round((p.typical_minutes / typical) * free), Math.round(p.typical_minutes * 1.5)));
      const s = { place_id: p.id, start_time: fromMin(t), duration_min: dur };
      t += dur;
      return s;
    });
  };

  let stops = build(order);
  let validation = validatePlan(stops, prefs, registry, weather);
  while (!validation.ok && order.length > 1) {
    // Drop the least important stop: a secondary activity first, then the last stop.
    const idx = order.findIndex((p, i) => i > 0 && p.kind === "activity");
    order = idx >= 0 ? order.filter((_, i) => i !== idx) : order.slice(0, -1);
    stops = build(order);
    validation = validatePlan(stops, prefs, registry, weather);
  }

  const plan = describePlan(stops, prefs, registry, activities, "Built by the rule-based fallback planner from real nearby places");
  return { plan, stops, validation };
}

/** Template prose for a set of stops (used by the rule-based planner and when salvaging an agent draft). */
export function describePlan(
  stops: PlanStopInput[],
  prefs: Preferences,
  registry: Registry,
  activities: Place[],
  origin: string,
): FinalPlan {
  return {
    title: `A ${prefs.energy === "low" ? "relaxed" : "well-paced"} Saturday in ${prefs.city}`,
    summary: `${origin}, ranked for your interests (${prefs.interests.join(", ") || "general"}), ${prefs.dietary !== "none" ? `${prefs.dietary} diet, ` : ""}${prefs.avoid_crowds ? "low crowds, " : ""}and your ${prefs.currency}${prefs.budget} budget.`,
    stops: stops.map((s) => {
      const p = registry.get(s.place_id)!;
      const reasons = [
        p.interest ? `matches your interest in ${p.interest}` : p.kind === "food" ? "a sit-down break to recharge" : "a good fit nearby",
        prefs.avoid_crowds && p.crowd_base === "low" ? "usually quiet" : "",
        p.kind === "food" && p.veg === "pure_veg" ? "fully vegetarian" : "",
        p.energy === "low" ? "easy on energy" : "",
      ].filter(Boolean);
      return {
        ...s,
        what_to_do: p.notes ?? (p.kind === "food" ? "Settle in for an unhurried meal." : `Spend unhurried time at ${p.name}.`),
        why_it_fits: `${reasons.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()),
      };
    }),
    plan_b: {
      trigger: "If it rains or a place is closed",
      suggestion: (() => {
        const alt = activities.find(
          (a) => a.indoor && !(prefs.avoid_crowds && a.crowd_base === "high") && !stops.some((s) => s.place_id === a.id),
        );
        return alt ? `Swap in ${alt.name} (indoor, ${alt.distance_km} km away).` : "Swap the outdoor stop for a long cafe sit-down near your food stop.";
      })(),
    },
    tips: ["Confirm opening hours on Google Maps before heading out.", "Book each auto or cab a few minutes early; Saturday evening traffic is slower."],
    assumptions: [],
  };
}
