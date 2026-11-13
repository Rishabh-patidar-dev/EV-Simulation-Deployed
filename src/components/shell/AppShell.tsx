"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { AppNotification } from "@/lib/notifications";
import type { StatusGroup } from "@/lib/status";
import Toaster from "@/components/ui/Toaster";
import CommandPalette from "./CommandPalette";
import { RAIL_COOKIE } from "./constants";
import { ShellContext, type ShellState } from "./ShellContext";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

/**
 * Sidebar + top bar + scrolling content, and the overlays every page shares.
 *
 * The rail is a fixed column on desktop — expanded or collapsed, remembered in
 * a cookie so the server renders the right width — and a sliding drawer below
 * `lg`, so the whole module map is still reachable on a phone.
 */
export default function AppShell({
  children,
  initialCollapsed,
  notifications,
  status,
}: {
  children: ReactNode;
  initialCollapsed: boolean;
  notifications: AppNotification[];
  status: StatusGroup[];
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsedState] = useState(initialCollapsed);
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // A navigation closes the mobile drawer. Adjusted during render, not in an
  // effect, so the drawer is already shut on the frame the new page paints.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setNavOpen(false);
  }

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    document.cookie = `${RAIL_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navOpen]);

  const shell = useMemo<ShellState>(
    () => ({
      collapsed,
      notifications,
      setCollapsed,
      openPalette: () => setPaletteOpen(true),
    }),
    [collapsed, notifications, setCollapsed]
  );

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible">
        <div className="hidden lg:flex print:hidden">
          <Sidebar />
        </div>

        {/* Mobile drawer: always mounted so it can slide, inert while closed. */}
        <div className="lg:hidden print:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            tabIndex={navOpen ? 0 : -1}
            onClick={() => setNavOpen(false)}
            className={`fixed inset-0 z-[60] transition-opacity duration-200 ${navOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
            style={{ background: "var(--overlay)" }}
          />
          <div
            inert={!navOpen}
            className={`fixed inset-y-0 left-0 z-[70] shadow-2xl transition-transform duration-200 ${navOpen ? "translate-x-0" : "-translate-x-full"}`}
          >
            <Sidebar mobile onNavigate={() => setNavOpen(false)} />
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
          <TopBar onOpenNav={() => setNavOpen(true)} notifications={notifications} status={status} />
          <main className="min-w-0 flex-1 overflow-y-auto overscroll-contain print:overflow-visible">{children}</main>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Toaster />
    </ShellContext.Provider>
  );
}
