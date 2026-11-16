"use client";

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
    <section className="rounded-2xl border-2 border-orange-300 bg-orange-50 p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-orange-900">Quick question{questions.length > 1 ? "s" : ""} before I plan</h2>
      {reason && <p className="mt-0.5 text-xs text-orange-800/80">{reason}</p>}
      <div className="mt-3 space-y-4">
        {questions.map((q, i) => (
          <div key={i}>
            <p className="text-sm font-medium text-stone-900">{q.question}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(q.options ?? []).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setAnswers(answers.map((a, j) => (j === i ? o : a)))}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    answers[i] === o ? "border-orange-500 bg-orange-500 text-white" : "border-orange-200 bg-white text-stone-700 hover:border-orange-400"
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
            <input
              value={answers[i]}
              onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))}
              placeholder="or type your answer"
              className="mt-2 w-full rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-sm focus:border-orange-500 focus:outline-none"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={!ready}
        onClick={() => onAnswer(questions.map((q, i) => ({ question: q.question, answer: answers[i] })))}
        className="mt-4 w-full rounded-xl bg-orange-500 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Continue planning
      </button>
    </section>
  );
}
