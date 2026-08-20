"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { GO_TO_SHORTCUTS } from "@/lib/go-to-shortcuts";
import { useCommandPalette } from "./command-palette-context";

const SEQUENCE_TIMEOUT_MS = 1200;

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// Renders nothing -- just wires up "g" then "<key>" navigation shortcuts app-wide,
// e.g. g d -> /dashboard. Mounted once inside CommandPaletteProvider (see
// AppShellFrame) so it can read the palette's open state and stay silent while
// the palette itself is open. Disabled while focus is in a form field.
export function GoToShortcuts() {
  const { open: paletteOpen } = useCommandPalette();
  const router = useRouter();
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
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) {
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
        router.push(match.href);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      clearPending();
    };
  }, [paletteOpen, router]);

  return null;
}
