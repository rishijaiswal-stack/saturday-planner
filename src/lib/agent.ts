// Orchestrator. Three phases, each using the cheapest reliable mechanism:
//   1. UNDERSTAND (LLM, 1 call): free text/form -> structured prefs, or ask
//      1-2 clarifying questions when input is too vague.
//   2. GATHER (code, parallel): geocode, weather, activity + food options.
//      These calls have no decisions in them, so sequencing them through the
//      LLM would only add round trips and tokens.
//   3. PLAN (LLM agent loop): the model chooses stops, may search for more
//      places, validates, and finalizes. The server re-validates every
//      finalize and bounces plans with violations back to the model.
// Any LLM failure degrades to the rule-based planner instead of erroring.

import { z } from "zod";
import { describePlan, energyFromMood, parseTimeWindow, rulesPlan, rulesUnderstand, type FormInput } from "./fallback";
import { routeUrl, toMin } from "./geo";
import { AllModelsFailedError, chat, MODELS, NoKeyError, type ChatCompletionMessageParam, type ChatCompletionTool } from "./llm";
import { PLAN_SYSTEM, UNDERSTAND_SYSTEM } from "./prompts";
import {
  getActivityOptions,
  getFoodOptions,
  parsePreferences,
  budgetUnderused,
  placeLine,
  Registry,
  repairPlan,
  searchPlaces,
  validatePlan,
  weatherFor,
  type OptionsResult,
  type RawPrefs,
} from "./tools";
import type { AgentEvent, FinalPlan, Place, PlanStopInput, Preferences, RenderedPlan, ValidationResult, WeatherSummary } from "./types";

export interface PlanRequest {
  form?: FormInput;
  text?: string;
  answers?: { question: string; answer: string }[];
}
type Emit = (e: AgentEvent) => void;

// ---------------------------------------------------------------------------
// Tool schemas (JSON Schema for the model, zod for validating what comes back)
// ---------------------------------------------------------------------------
const Prefs = z.object({
  city: z.string().optional().default(""),
  area: z.string().nullable().optional().transform((v) => v ?? undefined),
  budget: z.number().nullable().optional(),
  party_size: z.number().nullable().optional(),
  available_minutes: z.number().nullable().optional(),
  start_time: z.string().nullable().optional(),
  mood: z.string().optional().default(""),
  energy: z.enum(["low", "medium", "high"]).optional(),
  interests: z.array(z.string()).optional().default([]),
  constraints: z.array(z.string()).optional().default([]),
  dietary: z.enum(["vegetarian", "vegan", "jain", "none"]).optional(),
  avoid_crowds: z.boolean().optional(),
  assumptions: z.array(z.string()).optional().default([]),
});
const Clarify = z.object({
  reason: z.string().default(""),
  questions: z
    .array(z.object({ question: z.string(), options: z.array(z.string()).optional() }))
    .min(1)
    .max(2),
});
const Stop = z.object({
  place_id: z.string(),
  start_time: z.string(),
  duration_min: z.coerce.number(),
});
const ValidateArgs = z.object({ stops: z.array(Stop).min(1) });
const SearchArgs = z.object({ kind: z.enum(["activity", "food"]), query: z.string().min(1) });
const FinalizeArgs = z.object({
  title: z.string(),
  summary: z.string(),
  stops: z
    .array(Stop.extend({ what_to_do: z.string(), why_it_fits: z.string(), tradeoff: z.string().nullable().optional() }))
    .min(1),
  plan_b: z.object({ trigger: z.string(), suggestion: z.string() }),
  tips: z.array(z.string()).optional().default([]),
  budget_note: z.string().nullable().optional(),
  left_out: z
    .array(z.object({ interest: z.string(), reason: z.string() }))
    .nullable()
    .optional()
    .transform((v) => v ?? []),
});

const fn = (name: string, description: string, parameters: Record<string, unknown>): ChatCompletionTool => ({
  type: "function",
  function: { name, description, parameters },
});
const STOP_SCHEMA = {
  type: "object",
  properties: {
    place_id: { type: "string", description: "id from candidates/search results" },
    start_time: { type: "string", description: "HH:MM 24h" },
    duration_min: { type: "integer" },
  },
  required: ["place_id", "start_time", "duration_min"],
};

const UNDERSTAND_TOOLS: ChatCompletionTool[] = [
  fn("submit_preferences", "Submit the structured preferences.", {
    type: "object",
    properties: {
      city: { type: "string" },
      area: { type: ["string", "null"], description: "neighbourhood if mentioned" },
      budget: { type: ["number", "null"], description: "total budget in local currency for the whole party" },
      party_size: { type: ["integer", "null"] },
      available_minutes: { type: ["integer", "null"] },
      start_time: { type: ["string", "null"], description: "HH:MM, only if stated" },
      mood: { type: "string" },
      energy: { type: "string", enum: ["low", "medium", "high"] },
      interests: { type: "array", items: { type: "string" } },
      constraints: { type: "array", items: { type: "string" } },
      dietary: { type: "string", enum: ["vegetarian", "vegan", "jain", "none"] },
      avoid_crowds: { type: "boolean" },
      assumptions: { type: "array", items: { type: "string" } },
    },
    required: ["city", "mood", "energy", "interests", "constraints", "dietary", "avoid_crowds"],
  }),
  fn("ask_clarifying_questions", "Ask the user 1-2 short questions when the request is too vague to plan.", {
    type: "object",
    properties: {
      reason: { type: "string", description: "what is missing" },
      questions: {
        type: "array",
        maxItems: 2,
        items: {
          type: "object",
          properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } },
          required: ["question", "options"],
        },
      },
    },
    required: ["reason", "questions"],
  }),
];

const PLAN_TOOLS: ChatCompletionTool[] = [
  fn("search_places", "Search real places near the user for something the candidates don't cover (e.g. 'jazz', 'board game cafe').", {
    type: "object",
    properties: { kind: { type: "string", enum: ["activity", "food"] }, query: { type: "string" } },
    required: ["kind", "query"],
  }),
  fn("validate_plan", "Check a draft: travel times, opening hours, budget, diet, crowds, weather. Returns violations, warnings, timeline, cost.", {
    type: "object",
    properties: { stops: { type: "array", items: STOP_SCHEMA } },
    required: ["stops"],
  }),
  fn("finalize_plan", "Submit the final plan. It is validated server-side; plans with violations are rejected.", {
    type: "object",
    properties: {
      title: { type: "string", description: "catchy, max 8 words" },
      summary: { type: "string", description: "2 sentences: the shape of the day and why it suits them" },
      stops: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ...STOP_SCHEMA.properties,
            what_to_do: { type: "string" },
            why_it_fits: { type: "string" },
            tradeoff: { type: "string", description: "only if a warning applies to this stop" },
          },
          required: ["place_id", "start_time", "duration_min", "what_to_do", "why_it_fits"],
        },
      },
      plan_b: {
        type: "object",
        properties: { trigger: { type: "string" }, suggestion: { type: "string" } },
        required: ["trigger", "suggestion"],
      },
      tips: { type: "array", items: { type: "string" } },
      budget_note: {
        type: ["string", "null"],
        description: "Required when the plan uses under 30% of a generous budget: one sentence on why low-cost suits them (or what to add if they want to splurge).",
      },
      left_out: {
        type: ["array", "null"],
        description: "One entry per stated interest that no stop covers, with an honest reason.",
        items: {
          type: "object",
          properties: { interest: { type: "string" }, reason: { type: "string" } },
          required: ["interest", "reason"],
        },
      },
    },
    required: ["title", "summary", "stops", "plan_b", "tips"],
  }),
];

// ---------------------------------------------------------------------------
function describeInput(req: PlanRequest): string {
  const parts: string[] = [];
  if (req.form) parts.push(`Form input: ${JSON.stringify(req.form)}`);
  if (req.text) parts.push(`User wrote: """${req.text.slice(0, 1500)}"""`);
  if (req.answers?.length) {
    parts.push(`Answers to your clarifying questions:\n${req.answers.map((a) => `- ${a.question} -> ${a.answer}`).join("\n")}`);
    parts.push("The user has answered. Call submit_preferences NOW, using sensible defaults (listed in assumptions) for anything still missing. Do not ask more questions.");
  }
  return parts.join("\n");
}

function prefsBlock(p: Preferences, w: WeatherSummary | null): string {
  const startM = toMin(p.start_time);
  const endM = startM + p.available_minutes;
  const hourly = (w?.hours ?? [])
    .filter((h) => {
      const m = Number(h.hour.slice(0, 2)) * 60;
      return m >= startM - 60 && m <= endM;
    })
    .map((h) => `${h.hour} ${h.temp_c}°C rain${h.rain_prob}%`)
    .join(" | ");
  return [
    `USER: ${p.city}${p.area ? ` (${p.area})` : ""}, Saturday ${p.date}, window ${p.start_time}-${p.end_time} (${p.available_minutes} min)`,
    `budget ${p.currency}${p.budget} total for ${p.party_size} person(s); mood "${p.mood}" -> energy ${p.energy}`,
    `interests: ${p.interests.join(", ") || "none given"}; dietary: ${p.dietary}; avoid_crowds: ${p.avoid_crowds}; constraints: ${p.constraints.join(", ") || "none"}`,
    p.assumptions.length ? `assumptions made: ${p.assumptions.join(" ")}` : "",
    `WEATHER: ${w?.summary ?? "unknown"}${hourly ? `\nhourly: ${hourly}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function validationText(v: ValidationResult): string {
  const tl = v.timeline.map((t) => `${t.arrive}-${t.leave} ${t.name} (+${t.travel_from_prev_min}min ${t.travel_mode} before, crowd ${t.crowd_at_time})`).join("; ");
  return [
    `ok: ${v.ok}`,
    v.violations.length ? `VIOLATIONS (must fix): ${v.violations.join(" ")}` : "",
    v.warnings.length ? `WARNINGS (explain as tradeoffs if kept): ${v.warnings.join(" ")}` : "",
    `timeline: ${tl}`,
    `cost: stops ${v.cost.currency}${v.cost.stops_total} + travel ${v.cost.currency}${v.cost.travel_total} + 5% buffer = ${v.cost.currency}${v.cost.total} of ${v.cost.currency}${v.cost.budget}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// Models sometimes echo internal ids ("(cur:blr-sankey)") into prose; strip them.
const scrub = (t: string) => t.replace(/\s*\(?\b(?:cur|osm|geo|gen):[\w.:-]+\)?/g, "").replace(/\s{2,}/g, " ").trim();

function render(
  plan: FinalPlan,
  validation: ValidationResult,
  prefs: Preferences,
  weather: WeatherSummary | null,
  registry: Registry,
  by: RenderedPlan["generated_by"],
  model?: string,
): RenderedPlan {
  const places: Record<string, Place> = {};
  for (const s of plan.stops) {
    const p = registry.get(s.place_id);
    if (p) places[p.id] = p;
  }
  const pts = [{ lat: prefs.lat, lon: prefs.lon }, ...plan.stops.map((s) => places[s.place_id]).filter(Boolean)];
  return {
    ...plan,
    title: scrub(plan.title),
    summary: scrub(plan.summary),
    stops: plan.stops.map((s) => ({
      ...s,
      what_to_do: scrub(s.what_to_do),
      why_it_fits: scrub(s.why_it_fits),
      tradeoff: s.tradeoff ? scrub(s.tradeoff) : undefined,
    })),
    plan_b: { trigger: scrub(plan.plan_b.trigger), suggestion: scrub(plan.plan_b.suggestion) },
    tips: plan.tips.map(scrub),
    left_out: plan.left_out?.map((x) => ({ interest: x.interest, reason: scrub(x.reason) })),
    assumptions: [...prefs.assumptions, ...plan.assumptions],
    generated_by: by,
    model,
    preferences: prefs,
    weather,
    validation,
    places,
    route_url: routeUrl(pts),
  };
}

const summarize = (r: OptionsResult, label: string) =>
  `${r.places.length} ${label} (${r.curated_count} curated, ${r.live_count} live OSM${r.providers.length ? ` via ${r.providers.join("+")}` : ""}) within ${r.radius_km} km` +
  (r.provider_failures ? `; ${r.provider_failures} provider call(s) failed` : "") +
  (r.note ? `. ${r.note}` : "");

// ---------------------------------------------------------------------------
export async function runAgent(req: PlanRequest, emit: Emit): Promise<void> {
  const usage = { input: 0, output: 0, cache_read: 0, turns: 0 };
  const step = async <T>(name: string, input: unknown, fnc: () => Promise<T>, summarizeFn: (r: T) => string, data?: (r: T) => unknown) => {
    const id = `${name}-${Math.random().toString(36).slice(2, 7)}`;
    emit({ type: "tool_call", id, name, input });
    const t = Date.now();
    const r = await fnc();
    emit({ type: "tool_result", id, name, ok: true, ms: Date.now() - t, summary: summarizeFn(r), data: data?.(r) });
    return r;
  };
  let llmUp = true;
  const llmDown = (e: unknown) => {
    llmUp = false;
    const why = e instanceof NoKeyError ? "no GROQ_API_KEY configured" : e instanceof AllModelsFailedError ? "all models rate-limited/unavailable" : (e as Error).message;
    emit({ type: "status", message: `The AI model is unavailable (${why}); switching to the rule-based planner.` });
  };

  // ---------------- Phase 1: understand ----------------
  emit({ type: "status", message: "Understanding your request" });
  let raw: RawPrefs | null = null;
  const tU = Date.now();
  emit({ type: "tool_call", id: "understand", name: "understand_request", input: { source: req.text ? "free text" : "form", answers: req.answers?.length ?? 0 } });
  try {
    const sat = new Date().toDateString();
    const r = await chat({
      models: MODELS.understand,
      messages: [
        { role: "system", content: UNDERSTAND_SYSTEM },
        { role: "user", content: `Today is ${sat}.\n${describeInput(req)}` },
      ],
      tools: req.answers?.length ? UNDERSTAND_TOOLS.slice(0, 1) : UNDERSTAND_TOOLS,
      toolChoice: "required",
      maxTokens: 1200,
      onStatus: (m) => emit({ type: "status", message: m }),
    });
    usage.input += r.usage.input;
    usage.cache_read += r.usage.cached;
    usage.output += r.usage.output;
    usage.turns++;
    const call = r.toolCalls[0];
    let args: unknown = {};
    try {
      args = JSON.parse(call?.arguments || "{}");
    } catch {
      /* handled below */
    }
    if (call?.name === "ask_clarifying_questions" && !req.answers?.length) {
      const c = Clarify.safeParse(args);
      if (c.success) {
        emit({ type: "tool_result", id: "understand", name: "understand_request", ok: true, ms: Date.now() - tU, summary: `${r.model}: input too vague, asking ${c.data.questions.length} question(s)`, data: c.data });
        emit({ type: "clarify", questions: c.data.questions, reason: c.data.reason, resume: "" });
        emit({ type: "done", usage });
        return;
      }
    }
    const p = Prefs.safeParse(args);
    if (call?.name === "submit_preferences" && p.success) {
      raw = p.data;
      // Code enforces clear mood signals the model sometimes misses.
      const ruleEnergy = energyFromMood(raw.mood ?? "");
      if (ruleEnergy !== "medium" && raw.energy !== ruleEnergy) raw.energy = ruleEnergy;
      emit({ type: "tool_result", id: "understand", name: "understand_request", ok: true, ms: Date.now() - tU, summary: `${r.model} extracted preferences`, data: p.data });
    } else {
      emit({ type: "tool_result", id: "understand", name: "understand_request", ok: false, ms: Date.now() - tU, summary: "model output didn't match the schema; using rule-based extraction" });
    }
  } catch (e) {
    emit({ type: "tool_result", id: "understand", name: "understand_request", ok: false, ms: Date.now() - tU, summary: "LLM unavailable; using rule-based extraction" });
    llmDown(e);
  }
  raw ??= rulesUnderstand(req.form, [req.text, ...(req.answers ?? []).map((a) => a.answer)].filter(Boolean).join(". "));
  // Explicit clock times in the user's own words win over model extraction.
  const tw = parseTimeWindow([req.text, req.form?.available_time, req.form?.start_time, ...(req.answers ?? []).map((a) => a.answer)].filter(Boolean).join(". "));
  if (tw.start && raw.start_time !== tw.start) raw.start_time = tw.start;
  if (tw.minutes && raw.available_minutes !== tw.minutes) raw.available_minutes = tw.minutes;
  if (!raw.city && req.answers?.length) {
    const cityAnswer = req.answers.find((a) => /city/i.test(a.question))?.answer;
    if (cityAnswer) raw.city = cityAnswer;
  }

  // ---------------- Phase 2: gather (code) ----------------
  const parsed = await step(
    "parse_preferences",
    raw,
    () => parsePreferences(raw!),
    (r) => (r.ok ? `${r.prefs.city}: ${r.prefs.start_time}-${r.prefs.end_time}, ${r.prefs.currency}${r.prefs.budget}, energy ${r.prefs.energy}, diet ${r.prefs.dietary}` : `needs input: ${r.reason}`),
    (r) => (r.ok ? r.prefs : r),
  );
  if (!parsed.ok) {
    // Failure case handled as a question, not an error.
    emit({ type: "clarify", questions: [{ question: parsed.question, options: parsed.options }], reason: parsed.reason, resume: "" });
    emit({ type: "done", usage });
    return;
  }
  const prefs = parsed.prefs;
  const registry = new Registry();

  const weather = await step(
    "get_weather",
    { lat: prefs.lat, lon: prefs.lon, date: prefs.date },
    () => weatherFor(prefs),
    (w) => `${w.source}: ${w.summary}`,
    (w) => ({ ...w, hours: undefined }),
  );
  const [acts, foods] = await Promise.all([
    step(
      "get_activity_options",
      { city: prefs.city, interests: prefs.interests },
      () => getActivityOptions(prefs, weather, registry, 9),
      (r) => summarize(r, "activities"),
      (r) => r.places.map((p) => ({ id: p.id, name: p.name, source: p.source, km: p.distance_km })),
    ),
    step(
      "get_food_options",
      { city: prefs.city, budget: prefs.budget, dietary: prefs.dietary },
      () => getFoodOptions(prefs, weather, registry, 7),
      (r) => summarize(r, "food places"),
      (r) => r.places.map((p) => ({ id: p.id, name: p.name, veg: p.veg, source: p.source, km: p.distance_km })),
    ),
  ]);

  let lastValidDraft: PlanStopInput[] | null = null;
  const fallback = (reason: string) => {
    emit({ type: "status", message: reason });
    // If the agent already produced a draft that passed validation, keep its
    // choices and only template the prose; otherwise build from scratch.
    const salvaged = lastValidDraft
      ? (() => {
          const stops = lastValidDraft;
          const validation = validatePlan(stops, prefs, registry, weather);
          const plan = describePlan(stops, prefs, registry, acts.places, "The agent picked these stops and they passed validation before the AI model became unavailable");
          return { plan, validation };
        })()
      : null;
    if (salvaged) emit({ type: "status", message: "Using the agent's last validated draft." });
    const { plan, validation } = salvaged ?? rulesPlan(prefs, acts.places, foods.places, weather, registry);
    // Same completeness rules as the agent path, filled deterministically.
    plan.left_out = validation.uncovered_interests.map((i) => ({ interest: i, reason: "No suitable option fit within your time window and constraints." }));
    if (budgetUnderused(validation.cost.total, prefs)) {
      plan.budget_note = `This plan keeps most of your ${prefs.currency}${prefs.budget} budget free; the best-fitting options nearby happen to be low-cost.`;
    }
    emit({
      type: "tool_result",
      id: "rules",
      name: "rules_planner",
      ok: validation.ok,
      ms: 0,
      summary: `${plan.stops.length} stops, ${prefs.currency}${validation.cost.total}, ${validation.violations.length} violations`,
    });
    emit({ type: "plan", plan: render(plan, validation, prefs, weather, registry, "rules_fallback") });
    emit({ type: "done", usage });
  };
  if (!llmUp) return fallback("Building a plan with the rule-based planner.");

  // ---------------- Phase 3: plan (agent loop) ----------------
  emit({ type: "status", message: "Planning" });
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: PLAN_SYSTEM },
    {
      role: "user",
      content: [
        prefsBlock(prefs, weather),
        `ACTIVITY CANDIDATES (id | name | category | distance | cost/person (~=estimate) | crowd | in/outdoor | energy | typical time | hours | ...; "notable" = well-known, has a Wikipedia entry; prefer notable places when they fit):`,
        ...acts.places.map((p) => placeLine(p, prefs.currency)),
        `FOOD CANDIDATES:`,
        ...foods.places.map((p) => placeLine(p, prefs.currency)),
        `Plan the Saturday now.`,
      ].join("\n"),
    },
  ];

  let modelIndex = 0;
  let finalizeAttempts = 0;
  let qualityNudged = false;
  let searches = 0;
  const MAX_TURNS = 7;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let r;
    try {
      r = await chat({
        models: MODELS.plan,
        startModelIndex: modelIndex,
        messages,
        tools: PLAN_TOOLS,
        toolChoice: "auto",
        maxTokens: 4000,
        onReasoning: (d) => emit({ type: "thinking", text: d }),
        onStatus: (m) => emit({ type: "status", message: m }),
      });
    } catch (e) {
      llmDown(e);
      return fallback("Building the plan with the rule-based planner from the same candidates.");
    }
    modelIndex = r.modelIndex; // stick with the model that worked
    usage.input += r.usage.input;
    usage.cache_read += r.usage.cached;
    usage.output += r.usage.output;
    usage.turns++;

    if (r.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: r.content || "(no output)" });
      messages.push({ role: "user", content: "Submit the plan by calling finalize_plan (do not write it as text)." });
      continue;
    }
    messages.push({
      role: "assistant",
      content: r.content || null,
      tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments } })),
    });

    for (const call of r.toolCalls) {
      const reply = (content: string) => messages.push({ role: "tool", tool_call_id: call.id, content });
      let args: unknown;
      try {
        args = JSON.parse(call.arguments || "{}");
      } catch {
        reply("ERROR: arguments were not valid JSON. Call the tool again with valid JSON.");
        continue;
      }
      const t0 = Date.now();

      if (call.name === "search_places") {
        const a = SearchArgs.safeParse(args);
        if (!a.success || searches >= 3) {
          reply(a.success ? "ERROR: search limit reached; plan with the candidates you have." : `ERROR: ${a.error.issues[0]?.message}`);
          continue;
        }
        searches++;
        emit({ type: "tool_call", id: call.id, name: "search_places", input: a.data });
        const found = await searchPlaces(prefs, a.data.kind, a.data.query, registry);
        emit({ type: "tool_result", id: call.id, name: "search_places", ok: true, ms: Date.now() - t0, summary: `${found.length} results for "${a.data.query}"`, data: found.map((p) => p.name) });
        reply(found.length ? found.map((p) => placeLine(p, prefs.currency)).join("\n") : "No results. Use existing candidates.");
      } else if (call.name === "validate_plan") {
        const a = ValidateArgs.safeParse(args);
        if (!a.success) {
          reply(`ERROR: ${a.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
          continue;
        }
        emit({ type: "tool_call", id: call.id, name: "validate_plan", input: a.data });
        const rep = repairPlan(a.data.stops, prefs, registry, weather);
        const v = rep.validation;
        if (v.ok) lastValidDraft = rep.stops;
        emit({ type: "tool_result", id: call.id, name: "validate_plan", ok: v.ok, ms: Date.now() - t0, summary: `${v.ok ? "valid" : `${v.violations.length} violation(s)`}, ${v.warnings.length} warning(s), ${prefs.currency}${v.cost.total}`, data: { violations: v.violations, warnings: v.warnings } });
        reply((rep.notes.length ? `Server adjustments: ${rep.notes.join("; ")}\n` : "") + validationText(v));
      } else if (call.name === "finalize_plan") {
        const a = FinalizeArgs.safeParse(args);
        if (!a.success) {
          reply(`ERROR: ${a.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Call finalize_plan again.`);
          continue;
        }
        finalizeAttempts++;
        const rep = repairPlan(
          a.data.stops.map(({ place_id, start_time, duration_min }) => ({ place_id, start_time, duration_min })),
          prefs,
          registry,
          weather,
        );
        const stops = rep.stops;
        emit({ type: "tool_call", id: call.id, name: "finalize_plan", input: { title: a.data.title, stops, server_adjustments: rep.notes } });
        const v = rep.validation;
        emit({ type: "tool_result", id: call.id, name: "finalize_plan", ok: v.ok, ms: Date.now() - t0, summary: v.ok ? `accepted: ${stops.length} stops, ${prefs.currency}${v.cost.total}, ${v.warnings.length} trade-off(s)` : `rejected by validator: ${v.violations.join(" ")}`, data: { violations: v.violations, warnings: v.warnings } });
        if (!v.ok) {
          if (finalizeAttempts >= 3) return fallback("Agent couldn't produce a valid plan in 3 attempts; using the rule-based planner.");
          reply(`REJECTED. Fix every violation and call finalize_plan again.\n${rep.notes.length ? `(server already tried: ${rep.notes.join("; ")})\n` : ""}${validationText(v)}`);
          continue;
        }
        lastValidDraft = stops;
        // Quality gate (structured, not keyword-matched): every uncovered
        // interest needs a left_out entry and an underused generous budget
        // needs a budget_note. One nudge; then code fills honest defaults.
        const leftOut = a.data.left_out.filter((x) => x.interest && x.reason);
        const missingInterests = v.uncovered_interests.filter(
          (i) => !leftOut.some((x) => x.interest.toLowerCase().includes(i.toLowerCase()) || i.toLowerCase().includes(x.interest.toLowerCase())),
        );
        const needsBudgetNote = budgetUnderused(v.cost.total, prefs) && !a.data.budget_note?.trim();
        if ((missingInterests.length || needsBudgetNote) && !qualityNudged) {
          qualityNudged = true;
          const asks = [
            missingInterests.length ? `cover ${missingInterests.join(", ")} with a stop, or list each in left_out with an honest reason` : "",
            needsBudgetNote ? `the plan uses ${Math.round(v.budget_share * 100)}% of a ${prefs.currency}${prefs.budget} budget: upgrade a stop to a nicer paid option from the candidates, or fill budget_note with one sentence explaining why low-cost suits them` : "",
          ].filter(Boolean);
          emit({ type: "status", message: `Plan is valid but incomplete; asking the agent to ${asks.length > 1 ? "address coverage and budget" : missingInterests.length ? "address missing interests" : "address the unused budget"}` });
          reply(`ALMOST ACCEPTED. Before finalizing: ${asks.join("; ")}. Then call finalize_plan again with the full plan.`);
          continue;
        }
        for (const i of missingInterests) leftOut.push({ interest: i, reason: "No suitable option fit within your time window and constraints." });
        const budgetNote =
          a.data.budget_note?.trim() ||
          (budgetUnderused(v.cost.total, prefs)
            ? `This plan keeps most of your ${prefs.currency}${prefs.budget} budget free; the best-fitting options nearby happen to be low-cost.`
            : undefined);
        const plan: FinalPlan = {
          title: a.data.title,
          summary: a.data.summary,
          stops: stops.map((st) => {
            const prose = a.data.stops.find((x) => registry.resolve(x.place_id) === st.place_id) ?? a.data.stops[0];
            return { ...prose, place_id: st.place_id, start_time: st.start_time, duration_min: st.duration_min, tradeoff: prose.tradeoff || undefined };
          }),
          plan_b: a.data.plan_b,
          tips: a.data.tips.slice(0, 3),
          budget_note: budgetNote ? scrub(budgetNote) : undefined,
          left_out: leftOut,
          assumptions: [],
        };
        emit({ type: "plan", plan: render(plan, v, prefs, weather, registry, "agent", r.model) });
        emit({ type: "done", usage });
        return;
      } else {
        reply(`ERROR: unknown tool ${call.name}`);
      }
    }
  }
  return fallback("Agent ran out of steps; using the rule-based planner.");
}
