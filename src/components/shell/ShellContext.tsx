"use client";

import { createContext, useContext } from "react";
import type { AppNotification } from "@/lib/notifications";

/**
 * State the whole chrome shares: whether the desktop rail is collapsed, and
 * the command palette, which can be opened from the rail, the header and a
 * keyboard shortcut.
 */
export interface ShellState {
  collapsed: boolean;
  /** Everything that needs a human — the bell, the rail badge and the Notifications page all count from this. */
  notifications: AppNotification[];
  setCollapsed: (collapsed: boolean) => void;
  openPalette: () => void;
}

export const ShellContext = createContext<ShellState>({
  collapsed: false,
  notifications: [],
  setCollapsed: () => {},
  openPalette: () => {},
});

export const useShell = () => useContext(ShellContext);

