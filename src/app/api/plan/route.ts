// POST /api/plan -> Server-Sent Events stream of AgentEvents.
// SSE over a plain fetch stream: one-way server->client is all we need, works on
// Vercel serverless with no extra infra (vs WebSockets).

import { z } from "zod";
import { runAgent } from "@/lib/agent";
import type { AgentEvent } from "@/lib/types";

export const maxDuration = 120;

const Body = z.object({
  text: z.string().max(1500).optional(),
  form: z
    .object({
      city: z.string().max(80).optional(),
      area: z.string().max(80).optional(),
      budget: z.union([z.number(), z.string().max(12)]).optional(),
      available_time: z.string().max(40).optional(),
      start_time: z.string().max(5).optional(),
      party_size: z.union([z.number(), z.string().max(3)]).optional(),
      mood: z.string().max(200).optional(),
      interests: z.union([z.array(z.string().max(40)).max(8), z.string().max(300)]).optional(),
      constraints: z.union([z.array(z.string().max(60)).max(8), z.string().max(300)]).optional(),
    })
    .optional(),
  answers: z.array(z.object({ question: z.string().max(300), answer: z.string().max(200) })).max(2).optional(),
});

// Best-effort per-IP limiter (per serverless instance). Protects the shared
// free-tier LLM quota from one person hammering the button. A real deployment
// would use a shared store (Upstash/Redis).
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 12;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited(ip)) return Response.json({ error: "Too many plans from you in 10 minutes - take a breather and try again shortly." }, { status: 429 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.text?.trim() && !body.form?.city && !body.answers?.length) {
    return Response.json({ error: "Tell me a bit about your Saturday first." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (e: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          closed = true; // client went away
        }
      };
      try {
        await runAgent(body, emit);
      } catch (err) {
        console.error("agent crashed", err);
        emit({ type: "error", message: "Something went wrong while planning. Please try again.", recoverable: true });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
