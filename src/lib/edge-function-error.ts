import { FunctionsHttpError } from "@supabase/supabase-js";

// supabase.functions.invoke() reports a non-2xx response as a FunctionsHttpError whose own
// .message is always the generic "Edge Function returned a non-2xx status code" -- the real
// { error: "..." } body our edge functions send back on failure sits unread on
// error.context (the raw Response). This reads it, falling back to the generic message only
// if the body isn't JSON or has no .error field.
//
// NOTE: error.context is a Response body stream -- it can only be read once. Call this at
// most once per invoke() error.
export async function extractEdgeFunctionError(err: unknown, fallback: string): Promise<string> {
  if (err instanceof FunctionsHttpError) {
    try {
      const body = await err.context.json();
      if (typeof body?.error === "string") return body.error;
    } catch {
      // context wasn't JSON (or already consumed) -- fall through to the generic message.
    }
  }
  return err instanceof Error ? err.message : fallback;
}
