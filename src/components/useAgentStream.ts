"use client";

import { useCallback, useRef, useState } from "react";
import type { AgentEvent, ClarifyQuestion, RenderedPlan } from "@/lib/types";

export interface TraceStep {
  id: string;
  name: string;
  input?: unknown;
  status: "running" | "ok" | "fail";
  summary?: string;
  ms?: number;
  data?: unknown;
  t: number;
}

export interface StreamState {
  running: boolean;
  steps: TraceStep[];
  statuses: { t: number; message: string }[];
  thinking: string;
  clarify: { questions: ClarifyQuestion[]; reason: string } | null;
  plan: RenderedPlan | null;
  error: string | null;
  usage: { input: number; output: number; turns: number } | null;
  startedAt: number | null;
  finishedAt: number | null;
}

const EMPTY: StreamState = {
  running: false,
  steps: [],
  statuses: [],
  thinking: "",
  clarify: null,
  plan: null,
  error: null,
  usage: null,
  startedAt: null,
  finishedAt: null,
};

export interface PlanBody {
  text?: string;
  form?: Record<string, unknown>;
  answers?: { question: string; answer: string }[];
}

export function useAgentStream() {
  const [state, setState] = useState<StreamState>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);

  const apply = (e: AgentEvent) =>
    setState((s) => {
      switch (e.type) {
        case "status":
          return { ...s, statuses: [...s.statuses, { t: Date.now(), message: e.message }] };
        case "thinking":
          return { ...s, thinking: s.thinking + e.text };
        case "tool_call":
          return {
            ...s,
            steps: [...s.steps, { id: e.id, name: e.name, input: e.input, status: "running", t: Date.now() }],
          };
        case "tool_result": {
          const exists = s.steps.some((st) => st.id === e.id);
          const done: Partial<TraceStep> = { status: e.ok ? "ok" : "fail", summary: e.summary, ms: e.ms, data: e.data };
          return {
            ...s,
            steps: exists
              ? s.steps.map((st) => (st.id === e.id ? { ...st, ...done } : st))
              : [...s.steps, { id: e.id, name: e.name, t: Date.now(), status: "ok", ...done }],
          };
        }
        case "clarify":
          return { ...s, clarify: { questions: e.questions, reason: e.reason } };
        case "plan":
          return { ...s, plan: e.plan };
        case "error":
          return { ...s, error: e.message };
        case "done":
          return { ...s, usage: e.usage ?? null };
      }
    });

  const run = useCallback(async (body: PlanBody, keepTrace = false) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setState((s) => ({
      ...EMPTY,
      steps: keepTrace ? s.steps : [],
      statuses: keepTrace ? s.statuses : [],
      running: true,
      startedAt: Date.now(),
    }));
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (line) {
            try {
              apply(JSON.parse(line.slice(6)) as AgentEvent);
            } catch {
              /* ignore malformed */
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setState((s) => ({ ...s, error: (err as Error).message }));
    } finally {
      setState((s) => ({ ...s, running: false, finishedAt: Date.now() }));
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(EMPTY);
  }, []);

  return { state, run, reset };
}
