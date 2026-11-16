// Live place lookup with a provider chain:
//   Geoapify (if key)  ->  Photon (public)  ->  [caller falls back to curated]
// plus an in-memory TTL cache and a per-provider circuit breaker, so a dead
// provider costs one failed call per 2 minutes, not a timeout on every request.
// Geocoding chain: Photon -> Nominatim -> offline city table (in tools.ts).

import type { Place } from "../types";
import { geoapifyEnabled, geoapifySearch } from "./geoapify";
import { photonGeocode, photonSearch, type GeoResult, type PhotonSpec } from "./photon";

// ---- interests -> provider queries -------------------------------------------
interface InterestQuery {
  photon: PhotonSpec[];
  geo: string[];
}
const MAP: Record<string, InterestQuery> = {
  walk: {
    photon: [{ q: "park", tags: ["leisure:park"] }, { q: "lake", tags: ["natural:water"] }, { q: "garden", tags: ["leisure:garden", "leisure:park"] }],
    geo: ["leisure.park", "natural.water"],
  },
  nature: {
    photon: [{ q: "park", tags: ["leisure:park"] }, { q: "lake", tags: ["natural:water"] }],
    geo: ["leisure.park", "leisure.park.nature_reserve", "natural.water"],
  },
  music: {
    photon: [{ q: "music", tags: ["amenity:music_venue", "amenity:arts_centre", "amenity:pub", "amenity:bar"] }, { q: "live", tags: ["amenity:music_venue", "amenity:pub", "amenity:bar"] }],
    geo: ["entertainment.culture.arts_centre", "catering.pub", "catering.bar"],
  },
  art: {
    photon: [{ q: "gallery", tags: ["tourism:gallery", "amenity:arts_centre"] }, { q: "museum", tags: ["tourism:museum"] }],
    geo: ["entertainment.culture.gallery", "entertainment.culture.arts_centre", "entertainment.museum"],
  },
  museum: { photon: [{ q: "museum", tags: ["tourism:museum", "tourism:gallery"] }], geo: ["entertainment.museum", "entertainment.culture.gallery"] },
  history: {
    photon: [{ q: "fort", tags: ["historic:fort", "historic:castle", "tourism:attraction"] }, { q: "museum", tags: ["tourism:museum"] }],
    geo: ["tourism.sights", "entertainment.museum"],
  },
  books: { photon: [{ q: "book", tags: ["shop:books"] }], geo: ["commercial.books"] },
  shopping: { photon: [{ q: "mall", tags: ["shop:mall"] }, { q: "market", tags: ["amenity:marketplace"] }], geo: ["commercial.shopping_mall", "commercial.marketplace"] },
  movies: { photon: [{ q: "cinema", tags: ["amenity:cinema"] }], geo: ["entertainment.cinema"] },
  theatre: { photon: [{ q: "theatre", tags: ["amenity:theatre"] }], geo: ["entertainment.culture.theatre"] },
  games: { photon: [{ q: "bowling", tags: ["leisure:bowling_alley"] }, { q: "games", tags: ["leisure:amusement_arcade"] }], geo: ["entertainment"] },
  coffee: { photon: [{ q: "cafe", tags: ["amenity:cafe"] }], geo: ["catering.cafe"] },
  nightlife: { photon: [{ q: "pub", tags: ["amenity:pub", "amenity:bar"] }, { q: "bar", tags: ["amenity:bar", "amenity:pub"] }], geo: ["catering.pub", "catering.bar", "catering.taproom"] },
};
const SYNONYMS: [RegExp, string][] = [
  [/walk|stroll|hike|park|outdoor/, "walk"],
  [/nature|lake|garden|green/, "nature"],
  [/music|concert|gig|jazz|band|live/, "music"],
  [/art|gallery|paint|photo/, "art"],
  [/museum|science/, "museum"],
  [/history|heritage|monument|architecture/, "history"],
  [/book|read|librar/, "books"],
  [/shop|mall|market|thrift/, "shopping"],
  [/movie|film|cinema/, "movies"],
  [/theat|play|drama|comedy|standup|stand-up/, "theatre"],
  [/game|bowling|arcade/, "games"],
  [/coffee|cafe/, "coffee"],
  [/pub|bar\b|bars|beer|brew|drink|cocktail|nightlife|club/, "nightlife"],
];

export function canonicalInterest(interest: string): string {
  const s = interest.toLowerCase();
  for (const [re, key] of SYNONYMS) if (re.test(s)) return key;
  return s;
}

function queriesFor(interestOrQuery: string, kind: "activity" | "food", freeText: boolean): InterestQuery {
  if (kind === "food") {
    return freeText
      ? { photon: [{ q: interestOrQuery, tags: ["amenity:restaurant", "amenity:cafe", "amenity:fast_food"] }], geo: ["catering.restaurant", "catering.cafe"] }
      : {
          photon: [
            { q: "vegetarian", tags: ["amenity:restaurant", "amenity:cafe", "amenity:fast_food"] },
            { q: "cafe", tags: ["amenity:cafe"] },
            { q: "restaurant", tags: ["amenity:restaurant"] },
          ],
          geo: ["catering.restaurant", "catering.cafe"],
        };
  }
  const key = canonicalInterest(interestOrQuery);
  const base = MAP[key] ?? { photon: [{ q: interestOrQuery, tags: ["tourism:attraction", "amenity:arts_centre", "leisure:park"] }], geo: ["tourism.attraction", "entertainment"] };
  if (freeText && !MAP[key]) return { ...base, photon: [...base.photon, { q: interestOrQuery, tags: [] }] };
  return base;
}

// ---- cache, breaker, limiter -------------------------------------------------
const cache = new Map<string, { t: number; v: Place[] }>();
const TTL = 30 * 60_000;
const down: Record<string, number> = {};
const isDown = (p: string) => (down[p] ?? 0) > Date.now();
const trip = (p: string) => (down[p] = Date.now() + 2 * 60_000);

let active = 0;
const waiters: (() => void)[] = [];
async function limit<T>(fn: () => Promise<T>, max = 8): Promise<T> {
  if (active >= max) await new Promise<void>((r) => waiters.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

export interface LiveResult {
  places: Place[];
  provider: "geoapify" | "photon" | "cache" | "none";
  failures: number;
}

export async function liveSearch(opts: {
  kind: "activity" | "food";
  interest: string;
  freeText?: boolean;
  anchor: { lat: number; lon: number };
  radiusKm: number;
  factor: number;
  dietary: string;
}): Promise<LiveResult> {
  const { kind, interest, anchor, radiusKm, factor, dietary } = opts;
  const key = [kind, interest.toLowerCase(), anchor.lat.toFixed(3), anchor.lon.toFixed(3), radiusKm, dietary].join("|");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return { places: hit.v, provider: "cache", failures: 0 };

  const q = queriesFor(interest, kind, Boolean(opts.freeText));
  let failures = 0;

  if (geoapifyEnabled() && !isDown("geoapify")) {
    try {
      const cond = kind === "food" && dietary !== "none" ? (dietary === "vegan" ? "vegan" : "vegetarian") : undefined;
      const places = await geoapifySearch(q.geo, kind, anchor, radiusKm, factor, cond);
      if (places.length) {
        cache.set(key, { t: Date.now(), v: places });
        return { places, provider: "geoapify", failures };
      }
    } catch {
      failures++;
      trip("geoapify");
    }
  }

  if (!isDown("photon")) {
    const settled = await Promise.allSettled(q.photon.map((s) => limit(() => photonSearch(s, kind, anchor, radiusKm, factor))));
    const places = new Map<string, Place>();
    for (const r of settled) {
      if (r.status === "fulfilled") r.value.forEach((p) => places.set(p.id, p));
      else failures++;
    }
    if (settled.every((r) => r.status === "rejected")) trip("photon");
    if (places.size) {
      const v = [...places.values()];
      cache.set(key, { t: Date.now(), v });
      return { places: v, provider: "photon", failures };
    }
  }
  return { places: [], provider: "none", failures };
}

// ---- geocoding -----------------------------------------------------------------
async function nominatimGeocode(query: string): Promise<GeoResult | null> {
  const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "1", addressdetails: "1" });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": "saturday-planner/1.0 (assignment demo)" },
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const d = (await res.json()) as { lat: string; lon: string; display_name: string; address?: { country_code?: string } }[];
  if (!d[0]) return null;
  return { lat: Number(d[0].lat), lon: Number(d[0].lon), country_code: d[0].address?.country_code ?? "", display: d[0].display_name };
}

const geoCache = new Map<string, GeoResult | null>();
export async function geocode(query: string, bias?: { lat: number; lon: number }): Promise<GeoResult | null> {
  const k = `${query.toLowerCase()}|${bias?.lat.toFixed(2) ?? ""}`;
  if (geoCache.has(k)) return geoCache.get(k)!;
  let result: GeoResult | null = null;
  let anyOk = false;
  if (!isDown("photon")) {
    try {
      result = await photonGeocode(query, bias);
      anyOk = true;
    } catch {
      trip("photon");
    }
  }
  if (!result) {
    try {
      result = await nominatimGeocode(query);
      anyOk = true;
    } catch {
      /* fall through */
    }
  }
  if (!anyOk) throw new Error("all geocoders unavailable");
  geoCache.set(k, result);
  return result;
}
