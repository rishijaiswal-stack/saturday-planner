import { runAgent } from "../src/lib/agent";
runAgent(
  { text: "plan something fun for my saturday", answers: [{ question: "Which city are you in?", answer: "Bangalore" }, { question: "What's your budget?", answer: "₹1500" }] },
  (e) => { if (e.type === "plan") { console.log("PLAN", e.plan.generated_by, e.plan.title, e.plan.validation.cost.total, e.plan.stops.map((s) => `${s.start_time} ${e.plan.places[s.place_id]?.name}`).join(" | "), "\nassumptions:", e.plan.assumptions); } else if (e.type !== "thinking") console.log(JSON.stringify({ ...e, data: undefined }).slice(0, 220)); },
).then(() => console.log("END"));
