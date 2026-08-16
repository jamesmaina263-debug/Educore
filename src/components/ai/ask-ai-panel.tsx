"use client";

import { useState, useTransition } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { askEducoreAI } from "@/app/(app)/ai/actions";

export interface AIQueryLogRow {
  id: string;
  question_text: string;
  matched_intent: string | null;
  answer_text: string | null;
  created_at: string;
}

const SAMPLE_QUESTIONS = [
  "How many students are absent today?",
  "How many beds are available?",
  "Which students are in sick bay?",
  "Which inventory items are low in stock?",
  "Which classes are performing below average?",
  "Give me a summary of the school today.",
];

export function AskAIPanel({ initialHistory }: { initialHistory: AIQueryLogRow[] }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState(initialHistory);
  const [isPending, startTransition] = useTransition();

  function ask(q: string) {
    setError(null);
    setAnswer(null);
    startTransition(async () => {
      const result = await askEducoreAI(q);
      if (result.error) {
        setError(result.error);
      } else if (result.answer) {
        setAnswer(result.answer);
        setHistory((prev) => [
          {
            id: crypto.randomUUID(),
            question_text: q,
            matched_intent: null,
            answer_text: result.answer ?? null,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel max-w-2xl">
        <header className="border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Ask Educore AI</h2>
          <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
            Answers a fixed set of school-wide questions today — enrollment, attendance, fee
            collection, exam performance, boarding, health, and inventory. Only shows what your
            role already has access to, and won&apos;t guess beyond the fixed list.
          </p>
        </header>
        <div className="flex flex-col gap-3 p-4">
          <Textarea
            placeholder="e.g. How many students are at risk right now?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={isPending}
          />
          <div className="flex flex-wrap gap-2">
            {SAMPLE_QUESTIONS.map((sq) => (
              <Button
                key={sq}
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  setQuestion(sq);
                }}
              >
                {sq}
              </Button>
            ))}
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          {answer && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">{answer}</div>
          )}
          <div>
            <Button onClick={() => ask(question)} disabled={isPending || question.trim().length === 0}>
              {isPending ? "Thinking…" : "Ask"}
            </Button>
          </div>
        </div>
      </div>

      <div className="panel max-w-2xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div>
            <h2 className="text-[0.8125rem] font-semibold">Recent questions</h2>
            <p className="mt-0.5 text-[0.75rem] text-muted-foreground">Every question asked and its answer is logged for this school.</p>
          </div>
          <span className="text-[0.6875rem] text-muted-foreground">
            {history.length} question{history.length === 1 ? "" : "s"}
          </span>
        </header>
        <div className="p-4">
          {history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No questions asked yet.</p>
          ) : (
            <ul className="-my-1 divide-y divide-border">
              {history.map((h) => (
                <li key={h.id} className="py-2.5">
                  <p className="text-[0.8125rem] font-medium">{h.question_text}</p>
                  <p className="text-[0.75rem] text-muted-foreground">{h.answer_text ?? "—"}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
