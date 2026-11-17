// Shared domain types. Kept deliberately small: the LLM sees these shapes as
// tool inputs/outputs, so every field here is something the model or UI uses.

export type Crowd = "low" | "medium" | "high";
export type VegStatus = "pure_veg" | "veg_friendly" | "unknown" | "non_veg";
export type Energy = "low" | "medium" | "high";
export type Source = "osm_live" | "curated" | "generic";

export interface Place {
  id: string; // "osm:N123", "cur:blr-cubbon", "gen:home-walk"
  name: string;
  kind: "activity" | "food";
  category: string; // park, museum, cafe, restaurant, music_venue...
  lat: number;
  lon: number;
  address?: string;
  source: Source;
  est_cost_per_person: number; // local currency, heuristic or curated
  cost_confidence: "curated" | "heuristic";
  crowd_base: Crowd;
  indoor: boolean;
  energy: Energy; // physical effort the activity demands
  typical_minutes: number;
  hours?: string; // "HH:MM-HH:MM" (curated only; OSM via Photon has none)
  veg?: VegStatus; // food only
  notes?: string;
  notable?: boolean; // has a Wikipedia article linked in OSM (a cheap notability signal)
  distance_km?: number; // from the user's anchor point
  interest?: string; // which user interest surfaced this place
}

export interface Preferences {
  city: string;
  area?: string;
  country_code: string;
  currency: string;
  lat: number;
  lon: number;
  budget: number;
  party_size: number;
  available_minutes: number;
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  mood: string;
  energy: Energy;
  interests: string[];
  constraints: string[];
  dietary: "vegetarian" | "vegan" | "jain" | "none";
  avoid_crowds: boolean;
  date: string; // YYYY-MM-DD of the Saturday being planned
  assumptions: string[];
}

export interface HourWeather {
  hour: string; // HH:00
  temp_c: number;
  rain_prob: number;
  code: number;
}

export interface WeatherSummary {
  date: string;
  source: "open-meteo" | "unavailable";
  summary: string;
  max_c?: number;
  min_c?: number;
  max_rain_prob?: number;
  hours: HourWeather[];
}

export interface PlanStopInput {
  place_id: string;
  start_time: string; // HH:MM
  duration_min: number;
}

export interface TimelineEntry {
  place_id: string;
  name: string;
  arrive: string;
  leave: string;
  travel_from_prev_min: number;
  travel_mode: "walk" | "auto/cab" | "start";
  travel_km: number;
  travel_cost: number;
  stop_cost: number;
  crowd_at_time: Crowd;
}

export interface ValidationResult {
  ok: boolean;
  violations: string[]; // must fix
  warnings: string[]; // acceptable trade-offs, must be explained to the user
  timeline: TimelineEntry[];
  cost: {
    stops_total: number;
    travel_total: number;
    buffer: number;
    total: number;
    budget: number;
    remaining: number;
    currency: string;
  };
  total_minutes: number;
  uncovered_interests: string[];
  budget_share: number; // total / budget
}

export interface FinalStop {
  place_id: string;
  start_time: string;
  duration_min: number;
  what_to_do: string;
  why_it_fits: string;
  tradeoff?: string;
}

export interface FinalPlan {
  title: string;
  summary: string;
  stops: FinalStop[];
  plan_b: { trigger: string; suggestion: string };
  tips: string[];
  assumptions: string[];
  budget_note?: string; // why a generous budget is mostly unused
  left_out?: { interest: string; reason: string }[]; // stated interests not covered
}

// What the UI renders: LLM prose merged with code-computed facts.
export interface RenderedPlan extends FinalPlan {
  generated_by: "agent" | "rules_fallback";
  fallback_reason?: string; // shown in the UI when the rule-based planner was used
  model?: string;
  preferences: Preferences;
  weather: WeatherSummary | null;
  validation: ValidationResult;
  places: Record<string, Place>;
  route_url: string;
}

export interface ClarifyQuestion {
  question: string;
  options?: string[];
}

// Live capacity of the free AI tier, shown as a status pill in the UI.
export interface AiStatus {
  state: "ready" | "busy" | "daily_limit" | "unavailable" | "not_configured";
  model: string;
  tokens_left_minute?: number;
  tokens_limit_minute?: number;
  requests_left_today?: number;
  requests_limit_today?: number;
  daily_used?: number;
  daily_limit?: number;
  retry_at?: number; // epoch ms when it should be usable again
  checked_at: number;
  source: "probe" | "plan";
}

// Server -> client stream events (one JSON object per SSE "data:" line).
export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      id: string;
      name: string;
      summary: string;
      ok: boolean;
      ms: number;
      data?: unknown;
    }
  | { type: "clarify"; questions: ClarifyQuestion[]; reason: string; resume: string }
  | { type: "plan"; plan: RenderedPlan }
  | { type: "error"; message: string; recoverable: boolean }
  | { type: "ai_status"; status: AiStatus }
  | { type: "done"; usage?: { input: number; output: number; cache_read: number; turns: number } };
