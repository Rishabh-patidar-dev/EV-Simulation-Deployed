"use client";

import { useSyncExternalStore } from "react";

/**
 * Theme preference, shared by every control that shows or changes it.
 *
 * `<html data-theme>` is the single source of truth: "light" or "dark" when
 * the user has chosen one, absent when they follow the system — globals.css
 * already falls back to `prefers-color-scheme` in that case. The script in
 * layout.tsx stamps the attribute before first paint, so reading it here gives
 * the right answer on the very first client render.
 */

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "sim-theme";

function readPreference(): ThemePreference {
  const value = document.documentElement.getAttribute("data-theme");
  return value === "light" || value === "dark" ? value : "system";
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function setThemePreference(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
  try {
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Private browsing — the choice holds for this page, it just is not remembered.
  }
}

/** The user's choice — including "system". */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readPreference, () => "system");
}
