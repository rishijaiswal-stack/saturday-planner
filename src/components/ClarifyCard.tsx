"use client";

import { ArrowRight, MessageSquareText } from "lucide-react";
import { useState } from "react";
import type { ClarifyQuestion } from "@/lib/types";

export function ClarifyCard({
  questions,
  reason,
  onAnswer,
}: {
  questions: ClarifyQuestion[];
  reason: string;
  onAnswer: (answers: { question: string; answer: string }[]) => void;
}) {
  const [answers, setAnswers] = useState<string[]>(questions.map(() => ""));
  const ready = answers.every((a) => a.trim());
  return (
    <section className="rounded-2xl border border-indigo-200 bg-gradient-to-b from-indigo-50 to-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <MessageSquareText className="h-4.5 w-4.5" aria-hidden />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">A couple of details first</h2>
          {reason && <p className="mt-0.5 text-xs text-slate-500">{reason}</p>}
        </div>
      </div>
      <div className="mt-4 space-y-5">
        {questions.map((q, i) => (
          <div key={i}>
            <p className="text-sm font-medium text-slate-900">{q.question}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(q.options ?? []).map((o) => (
                <button
                  key={o}
                  type="button"
                  aria-pressed={answers[i] === o}
                  onClick={() => setAnswers(answers.map((a, j) => (j === i ? o : a)))}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    answers[i] === o
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300"
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
            <input
              value={answers[i]}
              onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))}
              placeholder="Or type your answer"
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={!ready}
        onClick={() => onAnswer(questions.map((q, i) => ({ question: q.question, answer: answers[i] })))}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
      >
        Continue <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
    </section>
  );
}
