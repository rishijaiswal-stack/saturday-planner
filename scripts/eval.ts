// Scenario harness: runs the real agent (real LLM, real data providers) over a
// fixed set of personas and checks each result against hard expectations.
// Usage: npm run eval            (all cases, ~60s apart to respect free-tier TPM)
//        npm run eval -- leh     (cases whose id contains "leh")
import { writeFileSync } from "node:fs";
import { runAgent, type PlanRequest } from "../src/lib/agent";
import type { AgentEvent, RenderedPlan } from "../src/lib/types";

interface Case {
  id: string;
  req: PlanRequest;
  expect: "plan" | "clarify";
  veg?: boolean;
}

const CASES: Case[] = [
  { id: "brief-bangalore", expect: "plan", veg: true, req: { form: { city: "Bangalore", budget: 2000, available_time: "4 hours", mood: "tired but wants to do something fun", interests: ["food", "music", "walks"], constraints: ["vegetarian", "avoid crowded places"] } } },
  { id: "leh-generous-budget", expect: "plan", veg: true, req: { form: { city: "Leh", budget: 12000, available_time: "4 hours", mood: "tired but wants to do something fun", interests: ["walks", "nature", "shopping"], constraints: ["vegetarian", "avoid crowded places"] } } },
  { id: "mumbai-couple-text", expect: "plan", veg: true, req: { text: "Me and my partner in Mumbai, ₹3500 total, from 4pm to 10pm. Feeling energetic! We love art, the sea and good vegetarian food." } },
  { id: "delhi-tight-budget", expect: "plan", veg: true, req: { text: "Delhi, only ₹500, 3 hours in the morning from 9am, love history and walking. Pure veg." } },
  { id: "vague-input", expect: "clarify", req: { text: "plan something fun for my saturday" } },
  { id: "unknown-city", expect: "clarify", req: { form: { city: "Atlantis", budget: 1000, available_time: "3 hours", mood: "curious", interests: ["walks"] } } },
  { id: "london-non-inr", expect: "plan", req: { text: "London, £80, 5 hours from noon, I love museums and a good pub. Not vegetarian." } },
  { id: "hampi-sparse-town", expect: "plan", veg: true, req: { form: { city: "Hampi", budget: 1500, available_time: "5 hours", mood: "relaxed", interests: ["history", "walks", "food"], constraints: ["vegetarian"] } } },
  { id: "pune-family-free", expect: "plan", req: { text: "Pune with my two kids, we want free or almost free things only, 3 hours in the evening, parks and something fun for kids." } },
  { id: "bangalore-indiranagar-area", expect: "plan", req: { form: { city: "Bangalore", area: "Indiranagar", budget: 3000, available_time: "6 hours", start_time: "11:00", party_size: 2, mood: "excited", interests: ["coffee", "books", "music"], constraints: ["no long commutes"] } } },
];

interface Row {
  id: string;
  outcome: string;
  passed: boolean;
  problems: string[];
  by?: string;
  stops?: string;
  cost?: string;
  budgetShare?: number;
  uncovered?: string[];
  leftOut?: string[];
  warnings?: number;
  latency: number;
  turns: number;
  tokens: number;
  cached: number;
  events: string[];
}

async function runCase(c: Case): Promise<Row> {
  const t0 = Date.now();
  let plan: RenderedPlan | null = null;
  let clarify = false;
  let error = "";
  let usage = { input: 0, output: 0, turns: 0, cache_read: 0 };
  const events: string[] = [];
  await runAgent(c.req, (e: AgentEvent) => {
    if (e.type === "plan") plan = e.plan;
    else if (e.type === "clarify") clarify = true;
    else if (e.type === "error") error = e.message;
    else if (e.type === "done" && e.usage) usage = e.usage;
    else if (e.type === "status" && /rate|fail|fallback|rule|incomplete|malformed|couldn't|unavailable/i.test(e.message)) events.push(e.message);
  });
  const latency = Math.round((Date.now() - t0) / 100) / 10;
  const problems: string[] = [];
  const outcome = plan ? "plan" : clarify ? "clarify" : error ? `error: ${error}` : "nothing";
  if (outcome !== c.expect) problems.push(`expected ${c.expect}, got ${outcome}`);
  const row: Row = { id: c.id, outcome, passed: false, problems, latency, turns: usage.turns, tokens: usage.input + usage.output, cached: usage.cache_read, events };
  const p = plan as RenderedPlan | null;
  if (p) {
    const v = p.validation;
    if (!v.ok) problems.push(`violations: ${v.violations.join(" | ")}`);
    if (v.cost.total > v.cost.budget * 1.1) problems.push("over budget");
    if (p.stops.length < 1) problems.push("no stops");
    const unexplained = v.uncovered_interests.filter((i) => !(p.left_out ?? []).some((x) => x.interest.toLowerCase().includes(i.toLowerCase()) || i.toLowerCase().includes(x.interest.toLowerCase())));
    if (unexplained.length) problems.push(`uncovered & unexplained: ${unexplained.join(", ")}`);
    if (v.budget_share < 0.3 && !p.budget_note && v.cost.budget - v.cost.total > 1000) problems.push("budget mostly unused, no note");
    if (c.veg && p.stops.some((s) => p.places[s.place_id]?.veg === "non_veg")) problems.push("non-veg stop for veg user");
    if (/\b(cur|osm|geo|gen):/.test(JSON.stringify([p.summary, p.stops.map((s) => [s.what_to_do, s.why_it_fits]), p.plan_b]))) problems.push("internal id leaked into prose");
    Object.assign(row, {
      by: p.generated_by === "agent" ? p.model : "rules_fallback",
      stops: p.stops.map((s) => `${s.start_time} ${p.places[s.place_id]?.name}`).join(" → "),
      cost: `${v.cost.currency}${v.cost.total}/${v.cost.currency}${v.cost.budget}`,
      budgetShare: Math.round(v.budget_share * 100),
      uncovered: v.uncovered_interests,
      leftOut: (p.left_out ?? []).map((x) => `${x.interest}: ${x.reason}`),
      warnings: v.warnings.length,
    });
  }
  row.passed = problems.length === 0;
  return row;
}

(async () => {
  const filter = process.argv[2];
  const cases = CASES.filter((c) => !filter || c.id.includes(filter));
  const rows: Row[] = [];
  for (let i = 0; i < cases.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, Number(process.env.EVAL_GAP_MS ?? 60000)));
    const row = await runCase(cases[i]);
    rows.push(row);
    console.log(`${row.passed ? "PASS" : "FAIL"} ${row.id} [${row.outcome}${row.by ? `, ${row.by}` : ""}] ${row.latency}s ${row.tokens} tok (${row.cached} cached) ${row.cost ?? ""} ${row.problems.join("; ")}`);
  }
  const pass = rows.filter((r) => r.passed).length;
  const agentPlans = rows.filter((r) => r.by && r.by !== "rules_fallback").length;
  const plans = rows.filter((r) => r.outcome === "plan").length;
  const md = [
    `# Scenario eval results`,
    ``,
    `Run: ${new Date().toISOString()} · ${pass}/${rows.length} passed · ${agentPlans}/${plans} plans written by the LLM (rest by fallbacks)`,
    ``,
    `| Case | Result | Outcome | Planned by | Stops | Cost | Budget used | Latency | LLM calls | Tokens (cached) | Problems |`,
    `|---|---|---|---|---|---|---|---|---|---|---|`,
    ...rows.map((r) => `| ${r.id} | ${r.passed ? "pass" : "**fail**"} | ${r.outcome} | ${r.by ?? "-"} | ${r.stops ?? "-"} | ${r.cost ?? "-"} | ${r.budgetShare ?? "-"}${r.budgetShare !== undefined ? "%" : ""} | ${r.latency}s | ${r.turns} | ${r.tokens} (${r.cached}) | ${r.problems.join("; ") || "-"} |`),
    ``,
    `## Details`,
    ...rows.flatMap((r) => [``, `### ${r.id}`, `- Left out: ${r.leftOut?.join("; ") || "none"}`, `- Warnings: ${r.warnings ?? 0}`, `- Notable events: ${r.events.join(" · ") || "none"}`]),
  ].join("\n");
  writeFileSync(filter ? `eval/RESULTS-${filter}.md` : "eval/RESULTS.md", md);
  console.log(`\n${pass}/${rows.length} passed`);
})();
