# Design decisions and trade-offs

The guiding principle: **the LLM decides, code computes.** The model does what only a model can do: understand messy human input, choose between options, weigh trade-offs, and explain them in human terms. Code does everything that has a right answer: geocoding, search, ranking, distances, travel time, money, opening hours, and constraint checks. Every number a user sees comes from code. Every sentence comes from the model.

---

## 1. Architecture: workflow + agent hybrid (not one giant prompt, not a free-roaming loop)

| Phase | Mechanism | Why |
|---|---|---|
| Understand | 1 LLM call with 2 tools (`submit_preferences` / `ask_clarifying_questions`) | Free text needs language understanding. The model also decides whether the input is too vague to plan. |
| Gather | Code, parallel | Weather, activity search and food search take inputs fully determined by the preferences. Letting the LLM sequence them adds about 4 round trips (~4× latency and tokens) and decides nothing. |
| Plan | LLM agent loop with `search_places`, `validate_plan`, `finalize_plan` | This is where judgment lives: which stops, in what order, which trade-offs. The model chooses which tools to call, and self-corrects when the validator rejects it. |

**Why not a fully autonomous ReAct loop over all 7 tools?** Three reasons:

1. **Free-tier token limits.** Groq's free tier allows roughly 8K tokens/min per model (`gpt-oss-120b`, `gpt-oss-20b`, `qwen3.8-27b`; check your org's limits page). A naive loop re-sends a growing context on every turn: 6 sequential tool calls × 4–8K tokens would exceed the limit for a single plan.
2. **Latency.** Each LLM turn adds about 1–3 s. Parallel code fetches finish in about 3 s total.
3. **Reliability.** Fewer model-driven steps means fewer places for an open model to go wrong.

This follows the common guidance for building agents: use the simplest pattern that works, keep fixed steps in code, and give the model autonomy only where the path genuinely depends on judgment.

**Why not one big prompt?** One prompt has to produce prices, times and distances, which LLMs get wrong. It can't be checked mid-way and can't recover. It also violates the brief.

## 2. The validator is the source of truth

`validate_plan` checks:

- **travel feasibility:** haversine × 1.35 road factor, city-specific Saturday speeds (Bangalore 17 km/h), walking under 1.2 km
- **overlaps and the time window**
- **opening hours**
- **budget:** per-person × party size + fares + ride home + 5% buffer. Over by up to 10% is a warning (a trade-off the model must explain); more than 10% is a violation.
- **diet:** non-veg is a violation, unverified veg is a warning
- **crowds:** crowd level at that hour on a Saturday, for users who want to avoid crowds
- **rain** during outdoor stops
- **energy** fit
- **grounding:** every `place_id` must have been returned by a tool in this run

`finalize_plan` re-runs the validator **server-side**. The model can't just claim its plan is fine. Rejected plans go back to the model with exact reasons, for up to 3 attempts, then the rule-based planner takes over.

**Code also repairs what it can before rejecting.** The model chooses *which* stops, their order and durations. Before validating, code:

- resolves sloppy IDs (a missing `cur:` prefix, or an exact place name) back to real ones
- moves start times to the earliest feasible arrival given real travel time
- if the model's order breaks opening hours or the window, tries the other orders of the same stops (at most 24 for 4 stops) and keeps the valid one closest to what the model intended

This came from live testing. The model kept underestimating Bangalore travel and placing a lake walk after closing time, and each rejection cost a full LLM round trip, which was fatal under free-tier token limits. Now most plans are accepted on the first finalize.

Grounding is what makes "avoid unrealistic suggestions" structural rather than a hope: **the model physically cannot put a made-up venue in the final plan.**

**Completeness is enforced through structure, not keywords.** Two failure modes showed up in testing: a ₹12,000 budget producing a ₹483 plan with no explanation, and a selected interest (shopping) silently dropped. Asking the model to "explain in the summary" didn't work; it wrote "fits your budget" and passed a keyword check. So the design changed:

- The validator works out from data which stated interests no stop covers, and what share of the budget the plan uses.
- `finalize_plan` has two structured fields: `left_out` (interest + reason) and `budget_note`.
- The server checks every uncovered interest has a matching `left_out` entry and that a generous budget left mostly unused has a `budget_note`. If not, it sends the plan back once with exactly what's missing.
- If the model still doesn't comply, code fills in honest default text rather than looping.
- The UI shows both: a budget note under the budget bar and a "Not included" section. The user always knows what was skipped and why.

The budget is treated as a **ceiling, not a target**. With a generous budget, ranking nudges substantive paid options up (a nicer restaurant, a ticketed venue) so the model has good upgrades to choose from. The validator also adds weather-comfort warnings for outdoor stops below 5°C or above 38°C, which came from a Leh test in November at −2°C.

## 3. LLM: Groq free tier with model routing and fallback chains

- **Why Groq:** free with no credit card, the fastest inference available (good for a live demo where latency is the UX), OpenAI-compatible tool calling, and good open models.
- **Trade-off accepted:** open models write somewhat weaker prose and make more tool-call mistakes than frontier models. Mitigated by zod validation of every tool argument, the server-side validator, and short, specific prompts.
- **Routing:**
  - Extraction uses `openai/gpt-oss-20b`: small and fast, and the task is easy. Keeping it off the big model's rate-limit bucket leaves that budget for planning.
  - Planning uses `openai/gpt-oss-120b`: a reasoning model, at `reasoning_effort: low` to save tokens. Its reasoning is streamed to the UI as "what the agent is thinking".
- **Fallback chain:** rate limits are per model, so on a 429 we move to the next model, which has its own bucket. That multiplies effective capacity. If Groq says "retry in ≤6s", we wait once first. When every model fails, the rule-based planner runs.
- **Swappable:** all provider code lives in `src/lib/llm.ts` (~150 lines). Moving to Claude, GPT or Gemini means re-implementing `chat()` only.

## 4. Real data: provider chain + curated layer

| Source | Role | Why |
|---|---|---|
| **Geoapify Places** (free key) | Primary live places | OSM data behind a reliable API; returns opening hours and diet tags, which feed hard checks |
| **Photon** (komoot, keyless) | Secondary live places | Fast OSM search, but a public demo server: flaky during the build |
| **Overpass** | Tried, not used | Public mirrors returned 502/504 "at capacity" throughout the build |
| **Curated list** (Bangalore, Mumbai, Delhi) | Enrichment + floor | OSM has no prices, crowd levels or reliable veg status; these ~60 places carry them. Also keeps the app working if every live API is down. |
| **Generic options** | Last resort | Honest, labelled suggestions when nothing matches, so the plan stays grounded |
| **Open-Meteo** | Weather | Free, keyless, hourly rain probability |

**Not chosen:**
- Google Places needs a billing account.
- Zomato and Swiggy have no public APIs, and scraping them is fragile and against their terms.
- Event sites (Insider, BookMyShow) have no free API. A scraper is a weekend project, not a 2-hour one.

**Resilience:** an in-memory 30-minute cache, a circuit breaker (a dead provider is skipped for 2 minutes instead of timing out every request), a hard 3 s timeout per call with all calls in parallel, and an offline table of city centres so common cities need no geocoding round trip.

**Honesty in the UI:** each place shows a source badge (Live OSM / Curated / Generic). Heuristic prices are marked "~", and veg status shows as "unverified" when we don't know.

## 5. Ranking in code before the LLM sees anything

Candidates are scored on:

- interest match
- distance
- crowd level (if the user wants to avoid crowds)
- energy fit
- indoor/outdoor vs rain
- price share of budget
- veg status
- curated (higher confidence)

Only the top ~10 activities (round-robin across interests, so each interest is represented) and ~8 food places go to the model. They're rendered as compact one-line rows rather than JSON, which costs roughly 60% fewer tokens.

This is the retrieve → rank → reason pattern: a smaller, better context gives better choices and stays within free-tier limits.

## 6. Clarifying questions without server state

The understand step can call `ask_clarifying_questions`: at most 2 questions, each with tap-able options. It's prompted to ask only when a plan would be a guess (no city, or ≥2 of budget/time/interests missing). Otherwise it assumes sensible defaults and lists them under "Assumptions I made".

The client re-sends the original input plus the answers, so there's no session store or database. On the second round the clarify tool isn't offered at all, so the model can't ask forever.

A missing or unfindable city is also caught deterministically in `parse_preferences`, so the failure becomes a question rather than an error even without the LLM.

## 7. Streaming: Server-Sent Events over `fetch`

The server pushes typed events: `tool_call`, `tool_result`, `thinking`, `status`, `clarify`, `plan`, `done`.

- **Why SSE:** one-way streaming is all we need. It works in a plain Vercel serverless function with no extra infrastructure, and degrades simply.
- **Why not WebSockets:** they need a stateful server.
- **Why not polling:** it needs storage and adds latency.

## 8. Stack: Next.js on Vercel

- **One repo, one deploy:** the UI and API are together, so there's no CORS and no second service.
- **Streaming route handlers out of the box.**
- **Full control over the trace and clarify UI.**
- **Why not Streamlit:** its rerun-the-script model fights multi-phase streaming and human-in-the-loop flows.
- **Why not FastAPI + React:** two deploys for no benefit at this size.
- **Why TypeScript end to end:** shared types between the agent events and the UI (`src/lib/types.ts`).
- **Why no LangChain/LangGraph:** the loop is ~150 readable lines. A framework would add abstraction to explain and debug without adding capability here.

## 9. Mood and constraints are wired into code, not just the prompt

- **"Tired"** sets energy to low, which:
  - shifts the default start to 16:00 (rest first, golden hour)
  - penalises demanding places in ranking
  - steers the prompt toward fewer stops, short hops and seated options
  - adds validator warnings for more than 4 stops or demanding places
- **"Avoid crowded places"** sets `avoid_crowds`, which:
  - penalises crowded places in ranking
  - feeds a Saturday crowd curve (lunch and evening bump parks, malls, pubs and popular eateries by one level; early morning lowers it)
  - triggers validator warnings that the model must explain as trade-offs
- **"Vegetarian"** sets `dietary`, which:
  - filters food by diet (`conditions=vegetarian` on Geoapify, plus name heuristics)
  - makes a non-veg stop a hard violation and an unverified one a warning

## 10. Abuse and safety

- API keys are server-side only.
- zod validates the request body, with length caps.
- A per-IP rate limit (12 plans per 10 minutes) protects the shared free quota.
- The agent loop is capped (7 turns, 3 searches, 3 finalize attempts), and every API call has a timeout.
- **Prompt injection:** user text can only influence that user's own plan. The model's only powers are three read-only tools with validated arguments. Output is rendered as text (React escapes it).

---

# Likely cross-questions

**"Is this really an agent if the gather step is hard-coded?"**
Yes, where it matters. In the planning phase the model decides whether to search for more places, when to validate, and when to finalize, and it revises after rejection. The gather step is hard-coded because it contains no decisions; making the model "decide" to fetch weather would be theatre that costs tokens and latency.

**"What if the model hallucinates a place or a price?"**
It can't get either into the final plan. Place IDs are checked against what tools returned, and all prices, times and distances are recomputed by code from tool data. The model's numbers are never shown.

**"How accurate are the prices?"**
Curated places have hand-checked per-person ranges. Live OSM places use category heuristics, marked "~" in the UI. Travel uses auto/cab fare formulas. The total includes the ride home and a 5% buffer, so it's conservative. The production fix is Google Places `price_level`.

**"What happens if Groq rate-limits you while we're testing?"**
The app retries once, then switches to the next model (separate bucket), and finally falls back to the rule-based planner, labelled in the UI. You always get a validated plan.

**"Why open models instead of GPT or Claude?"**
The brief rewards resourcefulness, and this costs $0. Speed matters for demo UX, and Groq is the fastest option. The validator compensates for weaker models. The provider is isolated in one file, so swapping is a 30-minute change if quality matters more than cost.

**"How would you evaluate plan quality?"**
There's already a working harness: `npm run eval` runs 10 scenarios through the real agent (real LLM, real data) and checks hard expectations: plan vs clarification, no violations, within budget, veg respected, every uncovered interest explained, an underused budget explained, no leaked internal IDs. Latest results are in [eval/RESULTS.md](eval/RESULTS.md). The cases cover the brief's example, Leh with a generous budget, a Mumbai couple in free text, ₹500 in Delhi, vague input, a made-up city, London in pounds, Hampi (sparse data), a Pune family wanting free things, and a neighbourhood start point.

Next steps would be:
1. Grow the set to ~30 personas, including rainy days and conflicting constraints.
2. Automatic metrics, mostly free because the validator exists:
   - first-attempt validity rate
   - fallback rate
   - budget utilisation
   - travel share of time
   - latency p50/p95
   - tokens per plan
3. An LLM-as-judge rubric for "fits mood/interests" and explanation quality.
4. A few human ratings to calibrate the judge.

**"How would you scale to 10k users a day?"**
- Paid LLM tier, or several providers behind the same `chat()` interface.
- Redis for the rate limit and cache.
- Precomputed city candidate pools refreshed nightly, so live search becomes a cache hit.
- A paid places API.

The architecture doesn't change: the stateless server and client-held clarify state already scale horizontally.

**"Why only one round of clarification, max 2 questions?"**
Every question is friction. The bar is "would the plan be a guess without it?" Everything else becomes a stated assumption the user can correct.

**"Why SSE and not WebSockets?"**
One-way stream, serverless-friendly, no extra infrastructure (see §7).

**"Isn't the curated list just mock data?"**
They're real places with real coordinates, used to enrich OSM with the metadata it lacks, and as a floor when live APIs fail. Live OSM results are always merged in, and the UI shows which is which. Outside the three cities, everything is live.

**"Why does 'tired' start the plan at 4pm?"**
That's the default only when no start time is given, and it's stated as an assumption. It gives rest first, cooler weather and golden-hour walks. Users can set any start time.

**"What would you do with more time?"**
- Live event listings for "music this Saturday"
- Google Places for prices and popular times
- A "refine" turn ("make it cheaper", "swap dinner")
- A map view
- Browser geolocation as the start point
- An eval harness in CI
