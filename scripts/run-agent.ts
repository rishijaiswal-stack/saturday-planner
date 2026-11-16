import { runAgent, type PlanRequest } from "../src/lib/agent";
const arg = process.argv[2] ?? "form";
const req: PlanRequest = arg === "form"
  ? { form: { city: "Bangalore", budget: 2000, available_time: "4 hours", mood: "tired but wants to do something fun", interests: ["food", "music", "walks"], constraints: ["vegetarian", "avoid crowded places"] } }
  : { text: arg };
runAgent(req, (e) => {
  if (e.type === "thinking") { process.stdout.write(e.text); return; }
  if (e.type === "plan") {
    const p = e.plan;
    console.log("\nPLAN", p.generated_by, "|", p.title, "\n ", p.summary);
    p.stops.forEach(s => console.log("  ", s.start_time, s.duration_min + "m", p.places[s.place_id]?.name, "\n     do:", s.what_to_do, "\n     why:", s.why_it_fits, s.tradeoff ? "\n     tradeoff: " + s.tradeoff : ""));
    console.log("  planB:", p.plan_b, "\n  cost:", p.validation.cost, "\n  warnings:", p.validation.warnings, "\n  violations:", p.validation.violations, "\n  route:", p.route_url);
    return;
  }
  console.log(JSON.stringify({ ...e, data: undefined }));
}).then(() => console.log("END"));
