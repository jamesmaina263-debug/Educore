"use client";

import { useState, useTransition } from "react";
import { askTutorQuestionAction } from "@/app/portal/learning/qa-actions";
import { MAX_QUESTION_CHARS } from "@/lib/ai/tutor-qa";

interface Exchange { id: string; question: string; text: string; sources: string[]; tone: "answer" | "notice" | "care" }

// The question box on the learner / parent portal. Shown only when the school has switched learner questions on AND
// completed the safeguarding set-up (the page checks tutor_qa_my_ready). Never shows anything the server did not return.
export function TutorQaBox({ studentId }: { studentId: string }) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<Exchange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function ask() {
    const q = text.trim();
    if (!q || pending) return;
    setError(null);
    start(async () => {
      const key = crypto.randomUUID();
      const res = await askTutorQuestionAction({ studentId, question: q, idempotencyKey: key });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems((prev) => [{ id: key, question: q, text: res.text, sources: res.sources, tone: res.status === "answered" ? "answer" : res.status === "safeguarding" ? "care" : "notice" }, ...prev]);
      setText("");
    });
  }

  return (
    <section className="space-y-2 rounded border p-3" aria-labelledby="tutor-qa-title">
      <h2 id="tutor-qa-title" className="text-sm font-semibold">Ask a question about your study guides</h2>
      <p className="text-xs text-muted-foreground">
        Answers come only from your teacher&apos;s approved study guides, and they are written by AI, so they can be wrong. Your teacher can see every question you ask.
        Please don&apos;t type names, phone numbers or addresses. If something is worrying you, tell a teacher or an adult you trust.
      </p>
      <label htmlFor="tutor-qa-input" className="sr-only">Your question</label>
      <textarea
        id="tutor-qa-input"
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_QUESTION_CHARS))}
        maxLength={MAX_QUESTION_CHARS}
        rows={3}
        className="w-full rounded border p-2 text-sm"
        placeholder="For example: What is a numerator?"
        disabled={pending}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{text.length}/{MAX_QUESTION_CHARS}</span>
        <button type="button" onClick={ask} disabled={pending || text.trim().length === 0} className="rounded border px-3 py-1 text-sm font-medium disabled:opacity-50">
          {pending ? "Thinking…" : "Ask"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <ul className="space-y-2" aria-live="polite">
        {items.map((it) => (
          <li key={it.id} className="rounded border p-3 text-sm">
            <p className="text-xs text-muted-foreground">You asked: {it.question}</p>
            <p className={`mt-1 whitespace-pre-wrap ${it.tone === "care" ? "font-medium" : ""}`}>{it.text}</p>
            {it.sources.length > 0 && <p className="mt-1 text-xs text-muted-foreground">From: {it.sources.join(", ")}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
