// GET /api/ai-status -> live capacity of the free AI tier for the status pill.
// Cached in memory for 5 minutes per instance (see lib/aiStatus.ts), so page
// loads can't burn the daily request allowance.

import { getAiStatus } from "@/lib/aiStatus";
import { MODELS } from "@/lib/llm";

export async function GET() {
  const status = await getAiStatus(MODELS.plan[0]);
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
