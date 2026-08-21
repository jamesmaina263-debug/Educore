"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { GO_TO_SHORTCUTS } from "@/lib/go-to-shortcuts";
import { useCommandPalette } from "./command-palette-context";
import { useOnlineStatus } from "@/hooks/use-online-status";

const SEQUENCE_TIMEOUT_MS = 1200;

function isShortcutBlockedTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) {
    return true;
  }
  // Radix Dialog/AlertDialog content renders role="dialog"/"alertdialog". Focus can
  // land on the dialog wrapper itself (not yet on an input) right after it opens, or
  // after clicking a button/checkbox inside it -- in either case isTypingTarget's
  // element checks above miss it, and a stray "g <letter>" while a form dialog is
  // open (invoices, staff registration, marks entry, admissions review, etc. --
  // 40+ places in this codebase use DialogContent) would navigate away and discard
  // whatever the user was filling in. Treat any focus inside an open dialog as
  // off-limits for navigation shortcuts.
  return !!el.closest('[role="dialog"], [role="alertdialog"]');
}

// Renders nothing -- just wires up "g" then "<key>" navigation shortcuts app-wide,
// e.g. g d -> /dashboard. Mounted once inside CommandPaletteProvider (see
// AppShellFrame) so it can read the palette's open state and stay silent while
// the palette itself is open. Also disabled while focus is in a form field or
// any open dialog -- see isShortcutBlockedTarget.
export function GoToShortcuts() {
  const { open: paletteOpen } = useCommandPalette();
  const router = useRouter();
  const online = useOnlineStatus();
  const awaitingSecondKey = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearPending = () => {
      awaitingSecondKey.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    if (paletteOpen) {
      clearPending();
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // A held key fires repeated keydown events with e.repeat === true. Without this
      // guard, holding "g" past the OS key-repeat delay produces a second synthetic
      // "g" keydown that the state machine below reads as the *second* key of a
      // sequence -- which matches the "g g" -> Home entry and silently navigates
      // away, even though the user never intended a second keypress.
      if (e.repeat) return;

      if (isShortcutBlockedTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) {
        clearPending();
        return;
      }

      if (!awaitingSecondKey.current) {
        if (e.key.toLowerCase() === "g") {
          awaitingSecondKey.current = true;
          timeoutRef.current = setTimeout(clearPending, SEQUENCE_TIMEOUT_MS);
        }
        return;
      }

      const key = e.key.toLowerCase();
      clearPending();

      const match = GO_TO_SHORTCUTS.find((s) => s.key === key);
      if (match) {
        e.preventDefault();
        // Same offline-forces-hard-navigation reasoning as sidebar-nav.tsx.
        if (!online) {
          window.location.href = match.href;
        } else {
          router.push(match.href);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      clearPending();
    };
  }, [paletteOpen, router, online]);

  return null;
}
