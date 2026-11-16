# Perfect Saturday Planner

An AI agent that plans a realistic, personalised Saturday. Tell it your city, budget, time, mood, interests and constraints, by form or in your own words. It checks **real places** (OpenStreetMap), the **real weather forecast**, **travel times** and your **budget**, then explains why each stop fits you. You can watch it work as it goes.

**Live demo:** _<add Vercel URL here>_

---

## What it does

- **Two input modes.** A quick form (pre-filled with the brief's example), or free text ("me and my partner in Mumbai, ₹3500, from 4pm…").
- **Asks 1–2 clarifying questions** when the input is too vague ("plan something fun for my saturday"), with answers you can tap.
- **Uses real data:**
  - places from OpenStreetMap (Geoapify → Photon), plus a small curated layer for Bangalore, Mumbai and Delhi that carries prices, crowd levels, veg status and hours
  - the weather forecast for the coming Saturday (Open-Meteo)
- **Builds a realistic timeline.** Every number (travel time, cost, crowd at that hour, opening hours, rain during outdoor stops) is computed by code and checked by a validator. The LLM never does arithmetic.
- **Explains itself.** Each stop gets a "why it fits you" line, a trade-off note when a compromise was made ("slightly over budget but quieter"), a Plan B, and the assumptions it made.
- **Streams its trace live.** Every tool call, its result and timing, plus the model's reasoning as it arrives.
- **Never shows a blank screen.** If the LLM is rate-limited or down, a rule-based planner builds a validated plan from the same data. If live place APIs are down, curated places keep it working.

## Architecture

```
Browser (Next.js page)  ──POST /api/plan──►  Route handler (SSE stream)
                                                   │
        ┌──────────────────────────────────────────┴───────────────────────────────┐
        │ 1. UNDERSTAND  (LLM, 1 call)   understand_request                        │
        │      free text / form ─► submit_preferences  OR  ask_clarifying_questions│
        │ 2. GATHER      (code, parallel)                                          │
        │      parse_preferences (normalise + geocode)                             │
        │      get_weather (Open-Meteo)                                            │
        │      get_activity_options ┐  Geoapify ─► Photon ─► curated ─► generic    │
        │      get_food_options     ┘  + ranking against the user's preferences    │
        │ 3. PLAN        (LLM agent loop, ≤7 turns)                                │
        │      tools: search_places · validate_plan · finalize_plan                │
        │      finalize is re-validated server-side; violations ─► bounced back    │
        │ 4. RENDER      LLM prose + code-computed facts (cost, timeline, links)   │
        └──────────────────────────────────────────────────────────────────────────┘
   LLM down / rate-limited at any point ─► rule-based planner (same data, same validator)
```

### Tools

| Tool | Kind | What it does |
|---|---|---|
| `understand_request` | LLM | Turns the form or free text into structured preferences, or asks clarifying questions |
| `parse_preferences` | code | Normalises fields (time window, budget, diet, crowd aversion), geocodes city and area, records assumptions |
| `get_weather` | code | Hourly forecast for the coming Saturday from Open-Meteo |
| `get_activity_options` | code | Real places per interest (provider chain), merged with curated places, ranked by fit |
| `get_food_options` | code | Real food places filtered by diet, ranked by budget, crowd and distance |
| `search_places` | code, called by the LLM | Targeted lookup when the candidates don't cover something ("jazz") |
| `validate_plan` | code, called by the LLM | Travel times, opening hours, budget, diet, crowd-at-time, rain, energy, and grounding (place IDs must come from a tool) |
| `finalize_plan` | code, called by the LLM | Submits the plan; the server re-validates and rejects it if anything is violated |
| `estimateCost` | code (inside the validator) | Per-person × party size + auto/cab fares + ride home + 5% buffer |

### Failure handling

| Failure | What happens |
|---|---|
| Input too vague | The LLM asks 1–2 questions with tap-able options |
| City not found / no city | Deterministic clarifying question (no LLM needed) |
| LLM rate-limited (free tier) | Short retry if Groq says "retry in ≤6s", else switch to the next model (separate rate-limit bucket) |
| All models down / no API key | Rule-based planner, clearly labelled in the UI |
| Model emits malformed tool JSON | Zod validation; the error goes back to the model to fix |
| Model plans an impossible schedule or a made-up place | Validator rejects it and the model revises (max 3 tries, then rule-based planner) |
| Place APIs down | Circuit breaker, then the next provider, then curated places, then generic options |
| Weather API down | The plan continues with an indoor Plan B, and says so |
| Nothing matches (sparse city, strict constraints) | Search widens 12 → 30 km, then labelled generic fallback options |

## Run locally

Requirements: Node 20+.

```bash
npm install
cp .env.example .env.local     # add GROQ_API_KEY (free), optionally GEOAPIFY_API_KEY (free)
npm run dev                    # http://localhost:3000
```

Without any keys the app still runs end to end on the rule-based planner, Photon and curated data.

Useful scripts:

```bash
npm run agent                                  # run the agent in the terminal on the brief's example
npm run agent -- "plan something fun"          # or any free text
npm run typecheck && npm run lint && npm run build
```

## Deploy (Vercel)

1. Push this repo to GitHub.
2. On vercel.com: **Add New → Project → import the repo**. No build settings needed.
3. Add the environment variables `GROQ_API_KEY` and (optionally) `GEOAPIFY_API_KEY`, then deploy.

## Stack

Next.js 16 (App Router) + TypeScript + Tailwind on Vercel · Groq (`openai/gpt-oss-120b` for planning, `openai/gpt-oss-20b` for understanding, `qwen/qwen3.8-27b` as fallback) via `groq-sdk` · zod · Geoapify / Photon (OpenStreetMap) · Open-Meteo.

See **[DESIGN.md](DESIGN.md)** for the reasoning behind each decision and the trade-offs.

## How I used AI tools

I used Claude Code as a pair programmer. I set the architecture and constraints (fixed steps in code vs. LLM judgment, server-side validation, fallback chains), and it scaffolded the code. Then we tested against the live APIs: Overpass and Photon outages during the build are why the provider chain and circuit breaker exist. I reviewed and adjusted the prompts, heuristics and curated data by hand.

## Known limitations

- Prices and crowd levels for live OSM places are category heuristics (labelled "~"). Curated places carry hand-checked ranges. Google Places (`price_level`, popular times) would be the production upgrade.
- Event listings (concerts this Saturday) are not live; music venues come from OSM and curated data.
- The rate limiter is in-memory per serverless instance; production would use Redis/Upstash.
