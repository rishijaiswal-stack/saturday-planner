// Curated layer: a small, hand-checked set of well-known places for a few
// cities. Two jobs:
//  1. Enrich: OSM (via Photon) gives real names + coordinates but no prices,
//     crowd levels, veg status or reliable hours. Curated entries carry those.
//  2. Fallback: if the live provider is down, the agent still has real places.
// Prices are approximate per-person figures in local currency; coordinates are
// approximate (~100-200 m). In production this layer would be replaced by
// Google Places (price_level, popular_times, opening_hours).

import type { Crowd, Energy, Place, VegStatus } from "../types";

type A = [
  slug: string,
  name: string,
  category: string,
  lat: number,
  lon: number,
  cost: number,
  crowd: Crowd,
  indoor: boolean,
  energy: Energy,
  minutes: number,
  hours: string,
  notes: string,
];
type F = [
  slug: string,
  name: string,
  category: string,
  lat: number,
  lon: number,
  cost: number,
  crowd: Crowd,
  veg: VegStatus,
  hours: string,
  notes: string,
];

function acts(prefix: string, area: string, rows: A[]): Place[] {
  return rows.map(([slug, name, category, lat, lon, cost, crowd, indoor, energy, minutes, hours, notes]) => ({
    id: `cur:${prefix}-${slug}`,
    name,
    kind: "activity" as const,
    category,
    lat,
    lon,
    address: area,
    source: "curated" as const,
    est_cost_per_person: cost,
    cost_confidence: "curated" as const,
    crowd_base: crowd,
    indoor,
    energy,
    typical_minutes: minutes,
    hours,
    notes,
  }));
}

function foods(prefix: string, area: string, rows: F[]): Place[] {
  return rows.map(([slug, name, category, lat, lon, cost, crowd, veg, hours, notes]) => ({
    id: `cur:${prefix}-${slug}`,
    name,
    kind: "food" as const,
    category,
    lat,
    lon,
    address: area,
    source: "curated" as const,
    est_cost_per_person: cost,
    cost_confidence: "curated" as const,
    crowd_base: crowd,
    indoor: true,
    energy: "low" as const,
    typical_minutes: 60,
    hours,
    veg,
    notes,
  }));
}

const BLR: Place[] = [
  ...acts("blr", "Bengaluru", [
    ["cubbon", "Cubbon Park", "park walk nature", 12.9763, 77.5929, 0, "medium", false, "medium", 75, "06:00-19:00", "Vehicle-free on weekends; shaded paths. Inner trails near the bandstand are quieter than the main avenues."],
    ["lalbagh", "Lalbagh Botanical Garden", "park garden walk nature", 12.9507, 77.5848, 30, "high", false, "medium", 90, "06:00-19:00", "Large and beautiful but busy on Saturday evenings; the lake side is calmer."],
    ["sankey", "Sankey Tank walking path", "lake walk nature", 13.009, 77.573, 0, "medium", false, "low", 50, "06:00-20:00", "Flat 1.5 km loop around the lake; good sunset spot; easy on tired legs."],
    ["ulsoor", "Ulsoor Lake", "lake walk nature", 12.983, 77.6206, 0, "low", false, "low", 45, "06:00-19:00", "Quiet lakeside path, boating sometimes available."],
    ["map", "Museum of Art & Photography (MAP)", "museum art gallery culture", 12.9741, 77.597, 150, "low", true, "low", 90, "10:00-18:30", "Air-conditioned, calm, lots of seating; Tue-Sun."],
    ["ngma", "National Gallery of Modern Art", "museum art gallery culture", 12.9907, 77.5874, 20, "low", true, "low", 75, "11:00-18:00", "Heritage mansion with a garden; rarely crowded; closed Mondays."],
    ["vitm", "Visvesvaraya Industrial & Technological Museum", "museum science", 12.9751, 77.5963, 85, "medium", true, "medium", 90, "09:30-18:00", "Hands-on exhibits; busy with families on weekends."],
    ["palace", "Bangalore Palace", "history palace attraction", 12.9987, 77.592, 300, "medium", true, "medium", 75, "10:00-17:30", "Tudor-style palace; audio guide included."],
    ["rangoli", "Rangoli Metro Art Center", "art gallery culture", 12.9755, 77.6066, 0, "low", true, "low", 40, "10:00-20:00", "Free art space on MG Road boulevard; small and quiet."],
    ["blossom", "Blossom Book House", "books bookstore", 12.9752, 77.6046, 0, "medium", true, "low", 45, "10:30-21:00", "Iconic multi-floor second-hand bookstore on Church Street."],
    ["churchst", "Church Street stroll", "street walk music nightlife", 12.975, 77.603, 0, "high", false, "low", 45, "10:00-23:00", "Bookshops, cafes, buskers; busiest after 6pm."],
    ["bic", "Bangalore International Centre", "music concert talks culture arts_centre", 12.96, 77.638, 300, "low", true, "low", 120, "10:00-21:30", "Regular weekend concerts and talks, many free or low-cost; check their listings for Saturday."],
    ["ranga", "Ranga Shankara", "theatre culture", 12.9119, 77.5851, 300, "medium", true, "low", 120, "15:00-21:30", "Theatre with shows most evenings; great cafe (Ranga Shankara canteen) on site."],
    ["windmills", "Windmills Craftworks", "music live_music jazz", 12.9791, 77.7213, 1500, "medium", true, "low", 150, "12:00-23:30", "Live jazz most evenings; far east in Whitefield; veg options available."],
    ["pecos", "Pecos", "music bar classic_rock", 12.9734, 77.6074, 500, "high", true, "low", 75, "11:00-23:00", "Legendary classic-rock bar off Brigade Road; cramped and loud on Saturdays."],
  ]),
  ...foods("blr", "Bengaluru", [
    ["mtr", "MTR (Mavalli Tiffin Rooms)", "restaurant south_indian", 12.9553, 77.5857, 350, "high", "pure_veg", "12:30-21:00", "Institution since 1924; expect a 20-40 min wait on weekends."],
    ["vb", "Vidyarthi Bhavan", "restaurant south_indian", 12.9451, 77.5713, 200, "high", "pure_veg", "14:00-20:00", "Famous masala dosa; queues on Saturdays; closed Fridays."],
    ["ctr", "CTR (Shri Sagar), Malleshwaram", "restaurant south_indian", 13.0004, 77.5713, 150, "high", "pure_veg", "16:00-21:00", "Benne masala dosa; standing tables, long queues."],
    ["green", "Green Theory", "restaurant cafe continental", 12.9688, 77.6064, 900, "low", "pure_veg", "12:00-23:00", "All-vegetarian, calm garden-style seating; good for unwinding."],
    ["sattvam", "Sattvam", "restaurant north_indian", 13.0072, 77.5806, 900, "low", "pure_veg", "12:00-23:00", "Quiet sattvic vegetarian fine dining; buffet and a la carte."],
    ["dyu", "Dyu Art Cafe", "cafe", 12.9336, 77.626, 450, "low", "veg_friendly", "10:00-22:00", "Calm courtyard cafe with art; mostly vegetarian menu."],
    ["koshys", "Koshy's", "restaurant cafe", 12.9737, 77.6011, 600, "medium", "veg_friendly", "09:00-23:00", "Old-world Bangalore cafe; mixed menu with good veg options."],
    ["matteo", "Matteo Coffea", "cafe coffee", 12.9751, 77.604, 350, "medium", "veg_friendly", "08:00-23:00", "Good coffee on Church Street; can get busy after 6pm."],
    ["rameshwaram", "The Rameshwaram Cafe, Indiranagar", "restaurant south_indian", 12.9784, 77.6408, 200, "high", "pure_veg", "06:30-23:30", "Excellent and cheap, but very crowded with standing-only seating."],
    ["gramin", "Gramin", "restaurant north_indian", 12.9352, 77.6245, 600, "medium", "pure_veg", "12:00-23:00", "Rustic vegetarian North Indian in Koramangala."],
  ]),
];

const BOM: Place[] = [
  ...acts("bom", "Mumbai", [
    ["marine", "Marine Drive promenade", "walk sea street", 18.9432, 72.8231, 0, "high", false, "low", 60, "00:00-23:59", "Sea-facing promenade; sunset is gorgeous but packed on Saturdays."],
    ["hanging", "Hanging Gardens (Malabar Hill)", "park garden walk", 18.9568, 72.8053, 0, "medium", false, "low", 45, "05:00-21:00", "Terraced garden with city views."],
    ["kalaghoda", "Jehangir Art Gallery, Kala Ghoda", "art gallery culture", 18.9271, 72.8317, 0, "medium", true, "low", 60, "11:00-19:00", "Free rotating exhibitions in the Kala Ghoda art district."],
    ["csmvs", "CSMVS Museum", "museum history culture", 18.9269, 72.8326, 150, "medium", true, "medium", 90, "10:15-18:00", "Major museum in a heritage building with gardens."],
    ["ncpa", "NCPA (National Centre for the Performing Arts)", "music concert theatre culture", 18.9256, 72.8197, 600, "low", true, "low", 120, "10:00-22:00", "Concerts most weekends; check listings."],
    ["carter", "Carter Road promenade, Bandra", "walk sea street", 19.067, 72.8227, 0, "medium", false, "low", 50, "00:00-23:59", "Breezy seafront walk with cafes nearby."],
    ["kitab", "Kitab Khana", "books bookstore", 18.9322, 72.8339, 0, "low", true, "low", 45, "10:30-20:30", "Beautiful bookstore in a heritage building in Fort."],
  ]),
  ...foods("bom", "Mumbai", [
    ["swati", "Swati Snacks, Tardeo", "restaurant gujarati", 18.969, 72.8126, 500, "high", "pure_veg", "11:00-22:30", "Iconic vegetarian; long weekend waits."],
    ["soam", "Soam, Babulnath", "restaurant gujarati", 18.959, 72.8097, 500, "medium", "pure_veg", "08:00-23:00", "Calmer alternative to Swati with similar food."],
    ["thaker", "Shree Thaker Bhojanalay", "restaurant thali", 18.9488, 72.8302, 700, "medium", "pure_veg", "11:30-22:00", "Unlimited Gujarati thali."],
    ["kyani", "Kyani & Co.", "cafe irani", 18.9445, 72.8266, 300, "medium", "veg_friendly", "07:00-21:00", "Old Irani cafe; bun maska and chai."],
    ["madras", "Cafe Madras, Matunga", "restaurant south_indian", 19.0275, 72.8553, 250, "high", "pure_veg", "07:00-22:30", "South Indian classics; queues on weekends."],
  ]),
];

const DEL: Place[] = [
  ...acts("del", "Delhi", [
    ["lodhi", "Lodhi Garden", "park garden walk history nature", 28.5931, 77.2197, 0, "medium", false, "medium", 60, "06:00-20:00", "Tombs among lawns; calm in late afternoons."],
    ["sunder", "Sunder Nursery", "park garden walk nature history", 28.5929, 77.244, 50, "medium", false, "medium", 75, "07:00-19:00", "Restored heritage park; well-kept and less chaotic than most."],
    ["humayun", "Humayun's Tomb", "history monument attraction", 28.5933, 77.2507, 40, "medium", false, "medium", 75, "06:00-18:00", "UNESCO site; arrive before 4pm for the best light."],
    ["ihc", "India Habitat Centre", "music concert talks culture arts_centre", 28.5893, 77.2253, 0, "low", true, "low", 120, "10:00-21:30", "Frequent free concerts and exhibitions; check listings."],
    ["knma", "Kiran Nadar Museum of Art, Saket", "museum art gallery culture", 28.5285, 77.219, 0, "low", true, "low", 75, "10:30-18:30", "Free, quiet modern art museum."],
    ["hauzkhas", "Hauz Khas Fort & Lake", "history lake walk", 28.5545, 77.194, 25, "high", false, "medium", 60, "10:00-19:00", "Ruins and deer park; village gets crowded in the evening."],
    ["national", "National Museum", "museum history culture", 28.6118, 77.2194, 20, "low", true, "medium", 90, "10:00-18:00", "Huge collection; pick 2-3 galleries."],
  ]),
  ...foods("del", "Delhi", [
    ["saravana", "Saravana Bhavan, Connaught Place", "restaurant south_indian", 28.6324, 77.2194, 400, "high", "pure_veg", "08:00-22:30", "Reliable vegetarian; busy at lunch."],
    ["sagar", "Sagar Ratna, Defence Colony", "restaurant south_indian", 28.5741, 77.2318, 400, "medium", "pure_veg", "08:00-23:00", "Classic South Indian vegetarian."],
    ["naivedyam", "Naivedyam, Hauz Khas", "restaurant south_indian", 28.5531, 77.1946, 450, "medium", "pure_veg", "11:00-23:00", "Temple-style interiors; vegetarian."],
    ["bigchill", "Big Chill, Khan Market", "restaurant cafe continental", 28.6003, 77.2273, 900, "high", "veg_friendly", "12:00-23:30", "Famous desserts; expect a wait on weekends."],
    ["haldirams", "Haldiram's, Connaught Place", "restaurant snacks", 28.6315, 77.2167, 300, "high", "pure_veg", "08:00-23:00", "Quick vegetarian chaat and thalis."],
  ]),
];

const CITY_ALIASES: Record<string, Place[]> = {
  bangalore: BLR,
  bengaluru: BLR,
  mumbai: BOM,
  bombay: BOM,
  delhi: DEL,
  "new delhi": DEL,
};

export function curatedFor(city: string): Place[] {
  return CITY_ALIASES[city.trim().toLowerCase()] ?? [];
}

// Known city centres so geocoding failures don't kill the run.
export const CITY_CENTRES: Record<string, { lat: number; lon: number; cc: string; name: string }> = {
  bangalore: { lat: 12.9716, lon: 77.5946, cc: "in", name: "Bengaluru" },
  bengaluru: { lat: 12.9716, lon: 77.5946, cc: "in", name: "Bengaluru" },
  mumbai: { lat: 19.076, lon: 72.8777, cc: "in", name: "Mumbai" },
  bombay: { lat: 19.076, lon: 72.8777, cc: "in", name: "Mumbai" },
  delhi: { lat: 28.6139, lon: 77.209, cc: "in", name: "Delhi" },
  "new delhi": { lat: 28.6139, lon: 77.209, cc: "in", name: "New Delhi" },
  pune: { lat: 18.5204, lon: 73.8567, cc: "in", name: "Pune" },
  hyderabad: { lat: 17.385, lon: 78.4867, cc: "in", name: "Hyderabad" },
  chennai: { lat: 13.0827, lon: 80.2707, cc: "in", name: "Chennai" },
  kolkata: { lat: 22.5726, lon: 88.3639, cc: "in", name: "Kolkata" },
  london: { lat: 51.5072, lon: -0.1276, cc: "gb", name: "London" },
  "new york": { lat: 40.7128, lon: -74.006, cc: "us", name: "New York" },
  singapore: { lat: 1.3521, lon: 103.8198, cc: "sg", name: "Singapore" },
  dubai: { lat: 25.2048, lon: 55.2708, cc: "ae", name: "Dubai" },
};

// Last-resort, location-agnostic options. They keep the plan grounded (the
// validator only accepts IDs it has seen) while being honest that no specific
// venue matched. Coordinates are set to the user's anchor at runtime.
export function genericOptions(lat: number, lon: number, currencyFactor: number): Place[] {
  const g = (
    slug: string,
    name: string,
    kind: "activity" | "food",
    category: string,
    cost: number,
    indoor: boolean,
    energy: Energy,
    minutes: number,
    notes: string,
    veg?: VegStatus,
  ): Place => ({
    id: `gen:${slug}`,
    name,
    kind,
    category,
    lat,
    lon,
    source: "generic",
    est_cost_per_person: Math.round(cost * currencyFactor),
    cost_confidence: "heuristic",
    crowd_base: "low",
    indoor,
    energy,
    typical_minutes: minutes,
    notes,
    veg,
  });
  return [
    g("neighbourhood-walk", "Unhurried walk around your neighbourhood park", "activity", "walk park", 0, false, "low", 45, "No venue matched; any nearby green space works."),
    g("home-music", "Curated listening session at home (album + chai)", "activity", "music", 0, true, "low", 60, "Pick one full album you've never heard start to finish."),
    g("local-cafe", "Nearest quiet neighbourhood cafe", "food", "cafe", 350, true, "low", 60, "Pick a small independent spot rather than a chain at peak hours.", "unknown"),
    g("home-cook", "Cook a simple vegetarian meal at home", "food", "home", 300, true, "low", 75, "Groceries cost only.", "pure_veg"),
  ];
}
