"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/** "⌘K" on Apple devices, "Ctrl K" elsewhere; null during server render so nothing mismatches. */
export function useShortcutLabel(): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => (/Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "⌘K" : "Ctrl K"),
    () => null
  );
}
