// Geoapify Places API: OpenStreetMap data behind a commercial API with a free
// tier (3,000 credits/day, no card). Preferred when GEOAPIFY_API_KEY is set
// because it's reliable (unlike the public Overpass/Photon servers) and it
// exposes OSM opening_hours and diet tags, which we use for hard checks.

import { round1 } from "../geo";
import type { Place, VegStatus } from "../types";
import { makePlace, saturdayHours } from "./heuristics";

// Geoapify place_ids are ~150 chars; the LLM sees every id, so shorten them.
function shortId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export const geoapifyEnabled = () => Boolean(process.env.GEOAPIFY_API_KEY);

interface GeoFeature {
  properties: {
    place_id?: string;
    name?: string;
    categories?: string[];
    lat: number;
    lon: number;
    distance?: number;
    address_line2?: string;
    formatted?: string;
    opening_hours?: string;
    catering?: { diet?: { vegetarian?: boolean | string; vegan?: boolean | string } };
    datasource?: { raw?: Record<string, unknown> };
  };
}

function vegOf(p: GeoFeature["properties"]): VegStatus | undefined {
  const raw = p.datasource?.raw ?? {};
  const tag = String(raw["diet:vegetarian"] ?? raw["diet:vegan"] ?? "");
  if (tag === "only") return "pure_veg";
  if (tag === "yes") return "veg_friendly";
  if (tag === "no") return "non_veg";
  const diet = p.catering?.diet;
  if (diet?.vegetarian === "only" || diet?.vegan === "only") return "pure_veg";
  if (diet?.vegetarian || diet?.vegan) return "veg_friendly";
  return undefined;
}

export async function geoapifySearch(
  categories: string[],
  kind: "activity" | "food",
  anchor: { lat: number; lon: number },
  radiusKm: number,
  factor: number,
  conditions?: string,
): Promise<Place[]> {
  const params = new URLSearchParams({
    categories: categories.join(","),
    filter: `circle:${anchor.lon},${anchor.lat},${Math.round(radiusKm * 1000)}`,
    bias: `proximity:${anchor.lon},${anchor.lat}`,
    limit: "25",
    lang: "en",
    apiKey: process.env.GEOAPIFY_API_KEY ?? "",
  });
  if (conditions) params.set("conditions", conditions);
  const res = await fetch(`https://api.geoapify.com/v2/places?${params}`, {
    signal: AbortSignal.timeout(6000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Geoapify HTTP ${res.status}`);
  const data = (await res.json()) as { features: GeoFeature[] };
  const out: Place[] = [];
  for (const f of data.features ?? []) {
    const p = f.properties;
    if (!p.name) continue;
    const tokens = (p.categories ?? []).flatMap((c) => c.split(".")).filter(Boolean);
    const raw = p.datasource?.raw ?? {};
    const oh = (p.opening_hours ?? raw["opening_hours"]) as string | undefined;
    const place = makePlace({
        id: `geo:${shortId(p.place_id ?? `${p.lat},${p.lon},${p.name}`)}`,
        name: p.name,
        kind,
        categoryTokens: tokens,
        lat: p.lat,
        lon: p.lon,
        address: p.address_line2 ?? p.formatted,
        factor,
        hours: saturdayHours(oh),
        veg: vegOf(p) ?? (conditions?.includes(".only") ? "pure_veg" : conditions ? "veg_friendly" : undefined),
        distance_km: round1((p.distance ?? 0) / 1000),
      });
    // OSM tags we can trust more than category heuristics.
    place.notable = Boolean(raw["wikipedia"]); // Wikipedia article = genuinely well-known (Wikidata alone is too broad)
    if (raw["fee"] === "no") place.est_cost_per_person = 0;
    out.push(place);
  }
  return out;
}
