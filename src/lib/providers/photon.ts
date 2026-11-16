// OpenStreetMap search via Photon (photon.komoot.io): free, keyless, fast.
// It's a public demo server, so we treat it as best-effort: low concurrency,
// short timeouts, and a circuit breaker (see places.ts) when it refuses us.

import { haversineKm, round1 } from "../geo";
import type { Place } from "../types";
import { makePlace } from "./heuristics";

const UA = "saturday-planner/1.0 (assignment demo)";
const BASE = "https://photon.komoot.io/api/";

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

interface PhotonFeature {
  properties: {
    osm_type?: string;
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    locality?: string;
    district?: string;
    city?: string;
    countrycode?: string;
  };
  geometry: { coordinates: [number, number] };
}

export interface GeoResult {
  lat: number;
  lon: number;
  country_code: string;
  display: string;
}

export async function photonGeocode(query: string, bias?: { lat: number; lon: number }): Promise<GeoResult | null> {
  const params = new URLSearchParams({ q: query, limit: "1", lang: "en" });
  if (bias) {
    params.set("lat", String(bias.lat));
    params.set("lon", String(bias.lon));
  } else {
    params.append("osm_tag", "place");
  }
  const data = (await fetchJson(`${BASE}?${params}`, 4000)) as { features: PhotonFeature[] };
  const f = data.features?.[0];
  if (!f) return null;
  const p = f.properties;
  return {
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    country_code: (p.countrycode ?? "").toLowerCase(),
    display: [p.name, p.city, p.countrycode].filter(Boolean).join(", "),
  };
}

export interface PhotonSpec {
  q: string;
  tags: string[];
}

export async function photonSearch(
  spec: PhotonSpec,
  kind: "activity" | "food",
  anchor: { lat: number; lon: number },
  radiusKm: number,
  factor: number,
): Promise<Place[]> {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((anchor.lat * Math.PI) / 180));
  const bbox = [anchor.lon - dLon, anchor.lat - dLat, anchor.lon + dLon, anchor.lat + dLat].map((n) => n.toFixed(4)).join(",");
  const params = new URLSearchParams({ q: spec.q, limit: "15", lang: "en", bbox, lat: String(anchor.lat), lon: String(anchor.lon) });
  spec.tags.forEach((t) => params.append("osm_tag", t));
  const data = (await fetchJson(`${BASE}?${params}`, 3000)) as { features: PhotonFeature[] };
  const out: Place[] = [];
  for (const f of data.features ?? []) {
    const p = f.properties;
    if (!p.name || !p.osm_id) continue;
    const [lon, lat] = f.geometry.coordinates;
    const d = round1(haversineKm(anchor.lat, anchor.lon, lat, lon));
    if (d > radiusKm * 1.1) continue;
    out.push(
      makePlace({
        id: `osm:${p.osm_type ?? "N"}${p.osm_id}`,
        name: p.name,
        kind,
        categoryTokens: [p.osm_key ?? "", p.osm_value ?? "place"],
        lat,
        lon,
        address: [p.housenumber, p.street, p.locality ?? p.district].filter(Boolean).join(", ") || p.city,
        factor,
        distance_km: d,
      }),
    );
  }
  return out;
}
