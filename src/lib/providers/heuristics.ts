// Shared heuristics for live places. Live sources give names, coordinates and
// (sometimes) hours/diet tags, but never prices or crowd levels. We attach
// transparent, category-based estimates (marked "~" / "est." in the UI) rather
// than letting the LLM guess numbers.

import type { Crowd, Energy, Place, VegStatus } from "../types";

export interface H {
  cost: number; // INR-authored, scaled by currency factor
  crowd: Crowd;
  indoor: boolean;
  energy: Energy;
  minutes: number;
}

export const HEUR: Record<string, H> = {
  park: { cost: 0, crowd: "medium", indoor: false, energy: "medium", minutes: 60 },
  garden: { cost: 0, crowd: "medium", indoor: false, energy: "medium", minutes: 50 },
  nature_reserve: { cost: 0, crowd: "low", indoor: false, energy: "medium", minutes: 75 },
  water: { cost: 0, crowd: "low", indoor: false, energy: "low", minutes: 45 },
  museum: { cost: 100, crowd: "low", indoor: true, energy: "low", minutes: 90 },
  gallery: { cost: 50, crowd: "low", indoor: true, energy: "low", minutes: 60 },
  arts_centre: { cost: 200, crowd: "low", indoor: true, energy: "low", minutes: 90 },
  music_venue: { cost: 600, crowd: "medium", indoor: true, energy: "low", minutes: 120 },
  events_venue: { cost: 500, crowd: "medium", indoor: true, energy: "low", minutes: 120 },
  theatre: { cost: 400, crowd: "medium", indoor: true, energy: "low", minutes: 120 },
  cinema: { cost: 350, crowd: "high", indoor: true, energy: "low", minutes: 150 },
  pub: { cost: 800, crowd: "high", indoor: true, energy: "low", minutes: 90 },
  bar: { cost: 800, crowd: "high", indoor: true, energy: "low", minutes: 90 },
  taproom: { cost: 900, crowd: "high", indoor: true, energy: "low", minutes: 90 },
  books: { cost: 0, crowd: "low", indoor: true, energy: "low", minutes: 45 },
  mall: { cost: 300, crowd: "high", indoor: true, energy: "medium", minutes: 90 },
  shopping_mall: { cost: 300, crowd: "high", indoor: true, energy: "medium", minutes: 90 },
  marketplace: { cost: 200, crowd: "high", indoor: false, energy: "medium", minutes: 60 },
  attraction: { cost: 100, crowd: "high", indoor: false, energy: "medium", minutes: 75 },
  sights: { cost: 100, crowd: "medium", indoor: false, energy: "medium", minutes: 60 },
  fort: { cost: 50, crowd: "medium", indoor: false, energy: "medium", minutes: 75 },
  castle: { cost: 100, crowd: "medium", indoor: false, energy: "medium", minutes: 75 },
  bowling_alley: { cost: 500, crowd: "medium", indoor: true, energy: "medium", minutes: 90 },
  amusement_arcade: { cost: 500, crowd: "medium", indoor: true, energy: "medium", minutes: 90 },
  cafe: { cost: 300, crowd: "medium", indoor: true, energy: "low", minutes: 60 },
  restaurant: { cost: 500, crowd: "medium", indoor: true, energy: "low", minutes: 60 },
  fast_food: { cost: 200, crowd: "medium", indoor: true, energy: "low", minutes: 40 },
};
export const DEFAULT_H: H = { cost: 200, crowd: "medium", indoor: true, energy: "low", minutes: 60 };

export function heuristicFor(categoryTokens: string[]): { key: string; h: H } {
  // Most specific token wins (e.g. "leisure.park.garden" -> garden).
  for (const t of [...categoryTokens].reverse()) if (HEUR[t]) return { key: t, h: HEUR[t] };
  return { key: categoryTokens[categoryTokens.length - 1] ?? "place", h: DEFAULT_H };
}

export function vegFromName(name: string): VegStatus {
  const n = name.toLowerCase();
  if (/pure veg|vegetarian|\bveg\b|vegan|jain|sattvic/.test(n)) return "pure_veg";
  if (/bhavan|bhavana|udupi|darshini|sagar|sweets|chaat|dosa|idli|tiffin/.test(n)) return "veg_friendly";
  if (/chicken|biryani|kebab|kabab|meat|fish|seafood|grill|bbq|mutton|steak/.test(n)) return "non_veg";
  return "unknown";
}

/**
 * Extract a Saturday time range from an OSM opening_hours string.
 * Handles the common forms: "Mo-Su 10:00-22:00", "Sa,Su 09:00-21:00; Mo-Fr ...",
 * "10:00-22:00", "24/7". Anything fancier -> undefined (treated as unverified).
 */
export function saturdayHours(oh: string | undefined): string | undefined {
  if (!oh) return undefined;
  const s = oh.trim();
  if (s === "24/7") return "00:00-23:59";
  const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const coversSat = (days: string) =>
    days.split(",").some((part) => {
      const [a, b] = part.trim().split("-");
      if (!b) return a === "Sa";
      const ia = DAYS.indexOf(a), ib = DAYS.indexOf(b);
      if (ia < 0 || ib < 0) return false;
      return ia <= ib ? ia <= 5 && 5 <= ib : 5 >= ia || 5 <= ib;
    });
  for (const rule of s.split(";")) {
    const r = rule.trim();
    const m = /^((?:[A-Z][a-z](?:-[A-Z][a-z])?,?)+)\s+(\d{2}:\d{2})-(\d{2}:\d{2})/.exec(r);
    if (m && coversSat(m[1])) return `${m[2]}-${m[3]}`;
    if (/^(?:[A-Z][a-z](?:-[A-Z][a-z])?,?)+\s+off$/.test(r) && coversSat(r.split(" ")[0])) return undefined;
    const bare = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(r);
    if (bare) return `${bare[1]}-${bare[2]}`;
  }
  return undefined;
}

export function makePlace(args: {
  id: string;
  name: string;
  kind: "activity" | "food";
  categoryTokens: string[];
  lat: number;
  lon: number;
  address?: string;
  factor: number;
  hours?: string;
  veg?: VegStatus;
  distance_km: number;
}): Place {
  const { key, h } = heuristicFor(args.categoryTokens);
  return {
    id: args.id,
    name: args.name,
    kind: args.kind,
    category: key,
    lat: args.lat,
    lon: args.lon,
    address: args.address,
    source: "osm_live",
    est_cost_per_person: Math.round(h.cost * args.factor),
    cost_confidence: "heuristic",
    crowd_base: h.crowd,
    indoor: h.indoor,
    energy: h.energy,
    typical_minutes: h.minutes,
    hours: args.hours,
    veg: args.kind === "food" ? args.veg ?? vegFromName(args.name) : undefined,
    distance_km: args.distance_km,
  };
}
