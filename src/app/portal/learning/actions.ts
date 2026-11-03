"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/bus-live";
import { parseSubmitResult, type SubmitResult } from "@/lib/learning-quiz-taking";

// Submits a quiz for a learner. The database function checks everything that matters again: the flag, that the caller
// is the learner or a guardian of that learner, that the quiz is published for the learner's class, and the attempt
// limit. Marking happens there too; the browser never sees an answer key.
export async function submitLearningQuizAction(quizId: string, studentId: string, answers: (number | null)[]): Promise<{ error: string } | { result: SubmitResult }> {
  if (!isUuid(quizId) || !isUuid(studentId)) return { error: "Quiz not available." };
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > 50) return { error: "Send an answer for every question." };
  if (!answers.every((a) => a === null || (Number.isInteger(a) && a >= 0 && a <= 5))) return { error: "Some answers are not valid." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_learning_quiz", { p_quiz_id: quizId, p_student_id: studentId, p_answers: answers });
  if (error) return { error: error.message };
  const result = parseSubmitResult(data);
  if (!result) return { error: "Your answers were sent, but the result could not be read. Refresh to see your score." };
  return { result };
}
