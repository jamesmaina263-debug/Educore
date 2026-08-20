// Central dispatch table for replaying queued offline mutations.
//
// Every entry is keyed "`${module}:${type}`" and points at the exact same
// Server Action the online path calls -- so a queued-then-replayed write
// goes through identical validation, RLS, and business logic as a live one.
// There's no separate "offline write path" to keep in sync with the real
// one.
//
// To add a new module: import its action here and add one line. Nothing
// else in the offline engine (db.ts / queue.ts / use-offline-sync.ts) needs
// to change.
"use client";

import { submitAttendance } from "@/app/(app)/attendance/actions";

export type MutationResult = { error: string } | { success: true } | Record<string, unknown>;
export type MutationHandler = (payload: never) => Promise<MutationResult>;

export const mutationHandlers: Record<string, MutationHandler> = {
  "attendance:submitAttendance": submitAttendance as MutationHandler,
};
