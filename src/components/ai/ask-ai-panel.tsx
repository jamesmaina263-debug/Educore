"use client";

import { useState, useTransition } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { askTrimoraAI } from "@/app/ai/actions";

export interface AIQueryLogRow {
  id: string;
  question_text: string;
  matched_intent: string | null;
  answer_text: string | null;
  created_at: string;
}

const SAMPLE_QUESTIONS = [
  "How many students are enrolled?",
  "What's our fee collection rate this term?",
  "How many students are at risk right now?",
  "What was the attendance rate today?",
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
      const result = await askTrimoraAI(q);
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
      <Card>
        <CardHeader>
          <CardTitle>Ask Trimora AI</CardTitle>
          <CardDescription>
            Answers a fixed set of school-wide questions today — enrollment, attendance, fee
            collection, at-risk students, exam averages. It won&apos;t guess beyond that.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
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
          {error && <p className="text-sm text-destructive">{error}</p>}
          {answer && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">{answer}</div>
          )}
        </CardContent>
        <CardFooter>
          <Button
            onClick={() => ask(question)}
            disabled={isPending || question.trim().length === 0}
          >
            {isPending ? "Thinking…" : "Ask"}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent questions</CardTitle>
          <CardDescription>Every question asked and its answer is logged for this school.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No questions asked yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {history.map((h) => (
                <li key={h.id} className="border-b border-border pb-2 last:border-0 last:pb-0">
                  <p className="text-sm font-medium">{h.question_text}</p>
                  <p className="text-sm text-muted-foreground">{h.answer_text ?? "—"}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
