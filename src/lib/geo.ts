// Pure, deterministic helpers. The LLM never does arithmetic: distances, travel
// time, money and clock maths all live here so they are testable and auditable.

import type { Crowd } from "./types";

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Average Saturday road speeds (km/h). Bangalore traffic is real; a straight-line
// "15 min" estimate would be the classic unrealistic-plan bug.
const CITY_SPEED: Record<string, number> = {
  bangalore: 17,
  bengaluru: 17,
  mumbai: 19,
  delhi: 22,
  "new delhi": 22,
  pune: 22,
  hyderabad: 22,
  chennai: 21,
  kolkata: 20,
};

const ROAD_FACTOR = 1.35; // straight line -> road distance
const WALK_KM_LIMIT = 1.2;

export interface Leg {
  km: number;
  minutes: number;
  mode: "walk" | "auto/cab";
  cost: number;
}

export function estimateLeg(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
  city: string,
  currency: CurrencyInfo,
): Leg {
  const straight = haversineKm(aLat, aLon, bLat, bLon);
  const km = straight * ROAD_FACTOR;
  if (straight <= WALK_KM_LIMIT) {
    return { km: round1(km), minutes: Math.max(3, Math.round(km * 13)), mode: "walk", cost: 0 };
  }
  const speed = CITY_SPEED[city.toLowerCase()] ?? 25;
  const minutes = Math.round((km / speed) * 60) + 6; // + pickup/wait
  const cost = Math.round((currency.cab_base + currency.cab_per_km * km) / 5) * 5;
  return { km: round1(km), minutes, mode: "auto/cab", cost };
}

export function round1(n: number) {
  return Math.round(n * 10) / 10;
}

// ---- currency & price level --------------------------------------------------
// Heuristic prices are authored in INR and scaled by a rough local price factor.
// They are labelled "est." in the UI; curated places carry hand-checked prices.
export interface CurrencyInfo {
  code: string;
  symbol: string;
  factor: number; // multiply INR-authored heuristic by this
  cab_base: number;
  cab_per_km: number;
}

const CURRENCIES: Record<string, CurrencyInfo> = {
  in: { code: "INR", symbol: "₹", factor: 1, cab_base: 40, cab_per_km: 18 },
  us: { code: "USD", symbol: "$", factor: 0.045, cab_base: 4, cab_per_km: 1.8 },
  gb: { code: "GBP", symbol: "£", factor: 0.035, cab_base: 4, cab_per_km: 1.6 },
  sg: { code: "SGD", symbol: "S$", factor: 0.05, cab_base: 4, cab_per_km: 0.8 },
  ae: { code: "AED", symbol: "AED ", factor: 0.13, cab_base: 12, cab_per_km: 2.2 },
  au: { code: "AUD", symbol: "A$", factor: 0.06, cab_base: 5, cab_per_km: 2.3 },
  ca: { code: "CAD", symbol: "C$", factor: 0.055, cab_base: 4, cab_per_km: 2 },
  eu: { code: "EUR", symbol: "€", factor: 0.035, cab_base: 4, cab_per_km: 1.8 },
};
const EURO = ["de", "fr", "es", "it", "nl", "be", "at", "pt", "ie", "fi", "gr"];

export function currencyFor(countryCode: string): CurrencyInfo {
  const cc = countryCode.toLowerCase();
  if (CURRENCIES[cc]) return CURRENCIES[cc];
  if (EURO.includes(cc)) return CURRENCIES.eu;
  return CURRENCIES.us;
}

// ---- time helpers ------------------------------------------------------------
export function toMin(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function fromMin(total: number): string {
  const t = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function withinHours(hours: string | undefined, startMin: number, endMin: number): boolean | null {
  if (!hours) return null; // unknown
  const [o, c] = hours.split("-").map(toMin);
  if (Number.isNaN(o) || Number.isNaN(c)) return null;
  const close = c <= o ? c + 1440 : c; // past midnight
  return startMin >= o && endMin <= close;
}

/** Upcoming Saturday as YYYY-MM-DD (today if it's Saturday before 6pm), in the given UTC offset-less sense. */
export function upcomingSaturday(now = new Date()): string {
  const d = new Date(now);
  const day = d.getDay(); // 6 = Saturday
  let add = (6 - day + 7) % 7;
  if (add === 0 && d.getHours() >= 18) add = 7;
  d.setDate(d.getDate() + add);
  // Local calendar date. toISOString() would convert to UTC and, east of UTC
  // in the early morning, return Friday (and fetch Friday's forecast).
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Saturday crowd curve: evenings and lunch peaks bump crowd one level for
// places that are crowd-sensitive (parks, malls, pubs, popular eateries).
const ORDER: Crowd[] = ["low", "medium", "high"];
export function crowdAt(base: Crowd, category: string, startMin: number): Crowd {
  const sensitive = /park|lake|mall|market|pub|bar|restaurant|cafe|attraction|street|garden/.test(category);
  const peak = (startMin >= 17 * 60 && startMin <= 21 * 60) || (startMin >= 12 * 60 + 30 && startMin <= 14 * 60);
  const early = startMin < 9 * 60;
  let idx = ORDER.indexOf(base);
  if (sensitive && peak) idx = Math.min(2, idx + 1);
  if (early) idx = Math.max(0, idx - 1);
  return ORDER[idx];
}

export function mapsUrl(lat: number, lon: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

export function routeUrl(points: { lat: number; lon: number }[]): string {
  if (points.length === 0) return "";
  const fmt = (p: { lat: number; lon: number }) => `${p.lat},${p.lon}`;
  const origin = fmt(points[0]);
  const dest = fmt(points[points.length - 1]);
  const way = points.slice(1, -1).map(fmt).join("|");
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}${way ? `&waypoints=${encodeURIComponent(way)}` : ""}&travelmode=driving`;
}
