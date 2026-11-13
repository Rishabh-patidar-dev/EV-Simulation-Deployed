"use client";

import { useSyncExternalStore } from "react";
import type { NotificationType } from "@/lib/notifications";

/**
 * The viewer's own notification state: which ones they have read and which
 * types they have muted. Per-browser convenience state, so localStorage is the
 * right home; every read and write is guarded, and the bell still works (all
 * unread, nothing muted) when storage is unavailable.
 */

interface PrefsState {
  read: string[];
  muted: NotificationType[];
}

const STORAGE_KEY = "sim-notifications";
const READ_CAP = 400;
const EMPTY: PrefsState = { read: [], muted: [] };

let cache: PrefsState | null = null;
const listeners = new Set<() => void>();

function load(): PrefsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<PrefsState>;
    return {
      read: Array.isArray(parsed.read) ? parsed.read.filter((v): v is string => typeof v === "string") : [],
      muted: Array.isArray(parsed.muted) ? (parsed.muted.filter((v) => typeof v === "string") as NotificationType[]) : [],
    };
  } catch {
    return EMPTY;
  }
}

function snapshot(): PrefsState {
  if (!cache) cache = load();
  return cache;
}

function commit(next: PrefsState) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked — the change still applies for this page view.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changed it — drop the cache so the next read picks it up.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useNotificationPrefs(): PrefsState {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

export function markRead(ids: string[]) {
  const current = snapshot();
  const merged = [...new Set([...ids, ...current.read])].slice(0, READ_CAP);
  commit({ ...current, read: merged });
}

export function markUnread(ids: string[]) {
  const current = snapshot();
  const drop = new Set(ids);
  commit({ ...current, read: current.read.filter((id) => !drop.has(id)) });
}

export function setMuted(type: NotificationType, muted: boolean) {
  const current = snapshot();
  const next = muted ? [...new Set([...current.muted, type])] : current.muted.filter((t) => t !== type);
  commit({ ...current, muted: next });
}
