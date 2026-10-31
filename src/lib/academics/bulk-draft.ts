// Drives "Draft AI comments for this stream": one AI draft per student, a few at a time, from the
// browser. It calls the EXISTING per-student draftCommentWithAI action once per learner (so each call
// stays inside the serverless time limit and keeps that action's permission check and per-user rate
// limit). This module only sequences the calls and decides when to stop; it never writes anything.

export interface DraftItem {
  id: string;
  name: string;
}

export type DraftStopReason = "cancelled" | "rate_limit" | "unavailable" | null;

export interface DraftProgress {
  total: number;
  attempted: number;
  succeeded: number;
  failed: { id: string; name: string; error: string }[];
  stopReason: DraftStopReason;
}

type DraftResult = { error: string } | { success: true };

/** Errors that mean "every further call will fail too", so stop instead of burning through the list. */
export function classifyDraftError(message: string): "rate_limit" | "unavailable" | "item" {
  if (/too many ai drafting requests/i.test(message)) return "rate_limit";
  if (/isn't configured|GEMINI_API_KEY|don't have permission|must be signed in|session has expired/i.test(message)) return "unavailable";
  return "item";
}

export async function runBulkDraft(
  items: DraftItem[],
  draft: (item: DraftItem) => Promise<DraftResult>,
  opts: { concurrency?: number; isCancelled?: () => boolean; onProgress?: (p: DraftProgress) => void } = {},
): Promise<DraftProgress> {
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const progress: DraftProgress = { total: items.length, attempted: 0, succeeded: 0, failed: [], stopReason: null };
  let next = 0;

  const worker = async () => {
    while (progress.stopReason === null) {
      if (opts.isCancelled?.()) {
        progress.stopReason = "cancelled";
        return;
      }
      const index = next++;
      if (index >= items.length) return;
      const item = items[index];
      let result: DraftResult;
      try {
        result = await draft(item);
      } catch {
        result = { error: "Couldn't reach the server. Please try again." };
      }
      progress.attempted += 1;
      if ("success" in result) {
        progress.succeeded += 1;
      } else {
        const kind = classifyDraftError(result.error);
        if (kind === "rate_limit" || kind === "unavailable") {
          // This learner was NOT drafted either; record it and stop the whole run.
          progress.failed.push({ id: item.id, name: item.name, error: result.error });
          if (progress.stopReason === null) progress.stopReason = kind;
        } else {
          progress.failed.push({ id: item.id, name: item.name, error: result.error });
        }
      }
      opts.onProgress?.({ ...progress, failed: [...progress.failed] });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, worker));
  return { ...progress, failed: [...progress.failed] };
}
