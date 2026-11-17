"use client";

// Live capacity of the free AI tier. Loads /api/ai-status on mount (server
// caches it for 5 minutes), takes fresher snapshots pushed at the end of each
// plan stream, refreshes every 5 minutes while the tab is visible, and
// re-checks as soon as a "busy" or "daily limit" wait runs out.

import { useCallback, useEffect, useState } from "react";
import type { AiStatus } from "@/lib/types";

const TOKENS_PER_PLAN = 3600; // measured on the live site after the token diet

function fmtWait(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.ceil(s / 60)} min`;
  return `${s}s`;
}

function fmtClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const TONE: Record<AiStatus["state"] | "loading", { dot: string; ring: string }> = {
  ready: { dot: "bg-emerald-500", ring: "ring-emerald-200 bg-emerald-50 text-emerald-900" },
  busy: { dot: "bg-amber-500", ring: "ring-amber-200 bg-amber-50 text-amber-900" },
  daily_limit: { dot: "bg-rose-500", ring: "ring-rose-200 bg-rose-50 text-rose-900" },
  not_configured: { dot: "bg-neutral-400", ring: "ring-neutral-200 bg-white text-neutral-700" },
  unavailable: { dot: "bg-neutral-400", ring: "ring-neutral-200 bg-white text-neutral-700" },
  loading: { dot: "bg-neutral-300", ring: "ring-neutral-200 bg-white text-neutral-500" },
};

export function AiStatusPill({ pushed }: { pushed: AiStatus | null }) {
  const [fetched, setFetched] = useState<AiStatus | null>(null);
  const [now, setNow] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => {
    fetch("/api/ai-status", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AiStatus>) : null))
      .then((j) => j && setFetched(j))
      .catch(() => {
        /* keep the last known status */
      });
  }, []);

  // Initial load, a reload whenever a wait ends, and every 5 minutes while visible.
  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5 * 60_000);
    return () => clearInterval(id);
  }, [load, reloadKey]);

  // Use whichever snapshot is newer: the probe or the last plan's own calls.
  const status = [fetched, pushed].filter((x): x is AiStatus => Boolean(x)).sort((a, b) => b.checked_at - a.checked_at)[0] ?? null;
  const waiting = status?.retry_at !== undefined && (status.state === "busy" || status.state === "daily_limit");
  const retryAt = status?.retry_at;

  // Countdown clock (ticks only while waiting) and a re-check when the wait ends.
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    if (!waiting || !retryAt) return () => clearTimeout(first);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const done = setTimeout(() => setReloadKey((k) => k + 1), Math.max(0, retryAt - Date.now()) + 1500);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      clearTimeout(done);
    };
  }, [waiting, retryAt]);

  const state = status?.state ?? "loading";
  const tone = TONE[state];
  let title = "Checking AI availability";
  let detail = "";
  if (status) {
    const left = status.retry_at ? status.retry_at - now : 0;
    switch (status.state) {
      case "ready": {
        title = "AI planner ready";
        const plans = status.tokens_left_minute !== undefined ? Math.max(1, Math.floor(status.tokens_left_minute / TOKENS_PER_PLAN)) : undefined;
        detail = [
          plans ? `About ${plans} plan${plans > 1 ? "s" : ""} available this minute` : "",
          status.requests_left_today !== undefined ? `${status.requests_left_today} of ${status.requests_limit_today ?? 1000} requests left today` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        break;
      }
      case "busy":
        title = "AI planner busy";
        detail = status.retry_at && left > 0 ? `Free per-minute limit reached. Ready again in ${fmtWait(left)}.` : "Free per-minute limit reached. Ready again shortly.";
        break;
      case "daily_limit":
        title = "Daily free AI limit reached";
        detail =
          status.retry_at && left > 0
            ? `Resets in about ${fmtWait(left)} (around ${fmtClock(status.retry_at)}). Until then, plans come from the rule-based planner.`
            : "Plans come from the rule-based planner until the allowance refills.";
        break;
      case "not_configured":
        title = "AI not configured";
        detail = "Plans come from the rule-based planner.";
        break;
      case "unavailable":
        title = "AI status unknown";
        detail = "Plans fall back to the rule-based planner automatically if needed.";
        break;
    }
  }

  return (
    <div className={`inline-flex max-w-full items-start gap-2 rounded-2xl px-3 py-1.5 text-xs ring-1 ring-inset ${tone.ring}`} role="status" aria-live="polite">
      <span className="relative mt-1 flex h-2 w-2 shrink-0">
        {state === "ready" && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:animate-none ${tone.dot}`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${tone.dot}`} />
      </span>
      <span className="min-w-0">
        <span className="font-semibold">{title}</span>
        {detail && <span className="block text-[11px] opacity-80">{detail}</span>}
      </span>
    </div>
  );
}
