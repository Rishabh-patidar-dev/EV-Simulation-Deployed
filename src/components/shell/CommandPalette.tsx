"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  FileSpreadsheet,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  Link2,
  Monitor,
  Moon,
  PanelLeft,
  RefreshCw,
  Search,
  ShoppingCart,
  Sun,
  UserPlus,
  UserRoundPlus,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { RAIL_SECTIONS } from "@/lib/modules";
import Icon from "@/components/ui/Icon";
import { setThemePreference, useThemePreference } from "@/components/theme/theme";
import { useShell } from "./ShellContext";

/**
 * ⌘K / Ctrl+K from anywhere: every module on the rail plus a handful of
 * actions, ranked as you type. Kept in rail order when the box is empty, with
 * the last few things run pinned on top as "Recent".
 *
 * A native <dialog> rather than a library modal: showModal() gives focus
 * containment, Escape-to-close and the top layer for free.
 */

interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  /** Sub-heading shown on the right — the rail group, or an action's area. */
  section?: string;
  icon: ReactNode;
  keywords: string[];
  /** Extra searchable text (a module's blurb) — matched, but ranked lowest. */
  context?: string;
  hint?: string;
  /** A hint that is a warning rather than a state, e.g. "Under development". */
  hintTone?: "brand" | "negative";
  perform: () => void;
}

const RECENT_KEY = "sim-palette-recent";
const RECENT_LIMIT = 5;

function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    // Recents are a convenience — carry on without them.
  }
}

const atWordStart = (text: string, token: string) => text.split(/[^a-z0-9]+/).some((word) => word.startsWith(token));

function isSubsequence(token: string, text: string) {
  let cursor = 0;
  for (const character of text) {
    if (character === token[cursor]) cursor += 1;
    if (cursor === token.length) return true;
  }
  return false;
}

function scoreToken(token: string, label: string, keywords: string[], context: string) {
  if (label === token) return 120;
  if (label.startsWith(token)) return 100;
  if (atWordStart(label, token)) return 80;
  if (label.includes(token)) return 60;
  if (keywords.some((k) => k.startsWith(token))) return 45;
  if (keywords.some((k) => k.includes(token))) return 35;
  if (context.includes(token)) return 20;
  if (isSubsequence(token, label)) return 10;
  return 0;
}

/** Sum of per-token scores; 0 when any token fails to match at all. */
function scoreCommand(command: PaletteCommand, tokens: string[]) {
  const label = command.label.toLowerCase();
  const keywords = command.keywords.map((k) => k.toLowerCase());
  const context = `${command.section ?? ""} ${command.group} ${command.context ?? ""}`.toLowerCase();
  let total = 0;
  for (const token of tokens) {
    const score = scoreToken(token, label, keywords, context);
    if (score === 0) return 0;
    total += score;
  }
  return total;
}

export default function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // The dialog element is the source of truth for being on screen; `open`
  // drives it. Closing by Escape fires "close", which reports back.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-label="Command palette"
      onClose={() => onOpenChange(false)}
      // A click that lands on the dialog itself (not its content) is the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      {/* Mounted only while open, so every opening starts from a clean query. */}
      {open && <PaletteBody onClose={() => onOpenChange(false)} />}
    </dialog>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const theme = useThemePreference();
  const { collapsed, setCollapsed } = useShell();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const itemRefs = useRef(new Map<number, HTMLDivElement>());

  const commands = useMemo<PaletteCommand[]>(() => {
    const go = (href: string) => () => router.push(href);

    const pages: PaletteCommand[] = [
      {
        id: "nav:/",
        label: "Dashboard",
        group: "Overview",
        icon: <LayoutDashboard className="h-4 w-4" />,
        keywords: ["home", "overview", "network", "kpi"],
        perform: go("/"),
      },
      ...RAIL_SECTIONS.flatMap((section) =>
        section.nodes.flatMap((node) => {
          const leaves = node.kind === "leaf" ? [node] : node.children;
          return leaves.map<PaletteCommand>((leaf) => ({
            id: `nav:${leaf.href}`,
            label: leaf.label,
            group: section.label,
            section: node.kind === "group" ? node.label : undefined,
            icon: <Icon name={leaf.icon} className="h-4 w-4" />,
            keywords: [leaf.href.split("/").filter(Boolean).join(" ")],
            context: leaf.blurb,
            hint: leaf.underDevelopment ? "Under development" : undefined,
            hintTone: leaf.underDevelopment ? "negative" : undefined,
            perform: go(leaf.href),
          }));
        })
      ),
    ];

    const actions: PaletteCommand[] = [
      {
        id: "action:add-lead",
        label: "Add a lead",
        group: "Actions",
        section: "Create",
        icon: <UserRoundPlus className="h-4 w-4" />,
        keywords: ["new lead", "create", "capture"],
        perform: go("/crm/leads?new=1"),
      },
      {
        id: "action:place-order",
        label: "Place a dealer order",
        group: "Actions",
        section: "Create",
        icon: <ShoppingCart className="h-4 w-4" />,
        keywords: ["new order", "purchase order", "po", "dealer order"],
        perform: go("/dms/orders?new=1"),
      },
      {
        id: "action:quotation",
        label: "Draft a quotation",
        group: "Actions",
        section: "Create",
        icon: <FileSpreadsheet className="h-4 w-4" />,
        keywords: ["quote", "quotation", "price", "gst", "proforma"],
        perform: go("/dms/quotations?new=1"),
      },
      {
        id: "action:test-drive",
        label: "Book a test drive",
        group: "Actions",
        section: "Create",
        icon: <CalendarClock className="h-4 w-4" />,
        keywords: ["demo", "test ride", "slot"],
        perform: go("/crm/test-drives?new=1"),
      },
      {
        id: "action:ticket",
        label: "Log a support ticket",
        group: "Actions",
        section: "Create",
        icon: <LifeBuoy className="h-4 w-4" />,
        keywords: ["complaint", "ticket", "support", "issue"],
        perform: go("/crm/support?new=1"),
      },
      {
        id: "action:job-card",
        label: "Open a job card",
        group: "Actions",
        section: "Create",
        icon: <Wrench className="h-4 w-4" />,
        keywords: ["service", "workshop", "repair", "job card"],
        perform: go("/dms/service/jobcards?new=1"),
      },
      {
        id: "action:loan",
        label: "Open a loan case",
        group: "Actions",
        section: "Create",
        icon: <Landmark className="h-4 w-4" />,
        keywords: ["finance", "loan", "emi", "nbfc"],
        perform: go("/dms/finance-insurance?new=1"),
      },
      {
        id: "action:invite-user",
        label: "Invite a user",
        group: "Actions",
        section: "Create",
        icon: <UserPlus className="h-4 w-4" />,
        keywords: ["new user", "add user", "access", "account"],
        perform: go("/admin/users?new=1"),
      },
      {
        id: "action:theme-light",
        label: "Switch to light theme",
        group: "Actions",
        section: "Appearance",
        icon: <Sun className="h-4 w-4" />,
        keywords: ["theme", "appearance", "day", "bright"],
        hint: theme === "light" ? "Current" : undefined,
        perform: () => setThemePreference("light"),
      },
      {
        id: "action:theme-dark",
        label: "Switch to dark theme",
        group: "Actions",
        section: "Appearance",
        icon: <Moon className="h-4 w-4" />,
        keywords: ["theme", "appearance", "night"],
        hint: theme === "dark" ? "Current" : undefined,
        perform: () => setThemePreference("dark"),
      },
      {
        id: "action:theme-system",
        label: "Use system theme",
        group: "Actions",
        section: "Appearance",
        icon: <Monitor className="h-4 w-4" />,
        keywords: ["theme", "appearance", "auto", "os"],
        hint: theme === "system" ? "Current" : undefined,
        perform: () => setThemePreference("system"),
      },
      {
        id: "action:toggle-rail",
        label: collapsed ? "Expand navigation" : "Collapse navigation",
        group: "Actions",
        section: "Workspace",
        icon: <PanelLeft className="h-4 w-4" />,
        keywords: ["sidebar", "rail", "menu", "minimise", "minimize", "width"],
        perform: () => setCollapsed(!collapsed),
      },
      {
        id: "action:refresh",
        label: "Refresh data",
        group: "Actions",
        section: "Workspace",
        icon: <RefreshCw className="h-4 w-4" />,
        keywords: ["reload", "update", "sync"],
        perform: () => {
          router.refresh();
          toast.success("Data refreshed", { description: "Every figure on this page was re-read from the store." });
        },
      },
      {
        id: "action:copy-link",
        label: "Copy link to this page",
        group: "Actions",
        section: "Workspace",
        icon: <Link2 className="h-4 w-4" />,
        keywords: ["share", "url", "clipboard"],
        perform: () => {
          navigator.clipboard.writeText(window.location.href).then(
            () => toast.success("Link copied", { description: "Filters and search are part of the link." }),
            () => toast.error("Could not copy the link", { description: "The browser refused clipboard access." })
          );
        },
      },
    ];

    return [...pages, ...actions];
  }, [router, theme, collapsed, setCollapsed]);

  const sections = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const grouped: Array<{ title: string; commands: PaletteCommand[] }> = [];

    if (tokens.length === 0) {
      const recentCommands = recent
        .map((id) => commands.find((c) => c.id === id))
        .filter((c): c is PaletteCommand => Boolean(c))
        .slice(0, RECENT_LIMIT);
      if (recentCommands.length) grouped.push({ title: "Recent", commands: recentCommands });
      for (const command of commands) {
        const existing = grouped.find((g) => g.title === command.group && g.title !== "Recent");
        if (existing) existing.commands.push(command);
        else grouped.push({ title: command.group, commands: [command] });
      }
    } else {
      const ranked = commands
        .map((command, index) => ({ command, index, score: scoreCommand(command, tokens) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map((entry) => entry.command);
      if (ranked.length) grouped.push({ title: "Results", commands: ranked });
    }

    let start = 0;
    return grouped.map((g) => {
      const section = { ...g, start };
      start += g.commands.length;
      return section;
    });
  }, [commands, query, recent]);

  const flat = useMemo(() => sections.flatMap((s) => s.commands), [sections]);
  const safeIndex = flat.length ? Math.min(activeIndex, flat.length - 1) : 0;

  useEffect(() => {
    itemRefs.current.get(safeIndex)?.scrollIntoView({ block: "nearest" });
  }, [safeIndex, sections]);

  const run = (command: PaletteCommand) => {
    const next = [command.id, ...readRecent().filter((id) => id !== command.id)].slice(0, RECENT_LIMIT);
    writeRecent(next);
    setRecent(next);
    onClose();
    command.perform();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!flat.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((safeIndex + 1) % flat.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((safeIndex - 1 + flat.length) % flat.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(flat.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = flat[safeIndex];
      if (command) run(command);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 px-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <Search className="h-[18px] w-[18px] shrink-0" style={{ color: "var(--brand-ink)" }} />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search modules and actions…"
          className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-[color:var(--fg-faint)]"
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-autocomplete="list"
          aria-activedescendant={flat.length ? `palette-option-${safeIndex}` : undefined}
        />
      </div>

      <div
        id="palette-list"
        role="listbox"
        aria-label="Commands"
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        // Keeps a row scrolled into view clear of the sticky group heading above it.
        style={{ scrollPaddingTop: 40, scrollPaddingBottom: 8 }}
      >
        {flat.length === 0 ? (
          <p className="px-3 py-10 text-center text-[13px]" style={{ color: "var(--fg-muted)" }}>
            Nothing matches “{query.trim()}”.
          </p>
        ) : (
          sections.map((section) => (
            <div key={section.title} role="group" aria-label={section.title}>
              {/* Sticks while its commands scroll past, so a short list never loses its place. */}
              <p className="menu-label sticky top-0 z-[1] px-3 pb-1.5 pt-3" style={{ background: "var(--card)" }}>
                {section.title}
              </p>
              {section.commands.map((command, i) => {
                const index = section.start + i;
                const active = index === safeIndex;
                return (
                  <div
                    key={`${section.title}:${command.id}`}
                    id={`palette-option-${index}`}
                    ref={(element) => {
                      if (element) itemRefs.current.set(index, element);
                      else itemRefs.current.delete(index);
                    }}
                    role="option"
                    aria-selected={active}
                    tabIndex={-1}
                    onMouseMove={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => run(command)}
                    className="flex h-9 cursor-pointer items-center gap-3 rounded-[9px] px-3 text-[13px]"
                    style={active ? { background: "var(--brand-soft)", color: "var(--brand-ink)" } : undefined}
                  >
                    <span className="shrink-0" style={{ color: active ? "var(--brand-ink)" : "var(--fg-faint)" }}>
                      {command.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{command.label}</span>
                    {command.hint && <span className={`pill shrink-0 pill-${command.hintTone ?? "brand"}`}>{command.hint}</span>}
                    {command.section && (
                      <span className="hidden shrink-0 truncate text-[11.5px] sm:block" style={{ color: "var(--fg-faint)" }}>
                        {command.section}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div
        className="flex items-center gap-4 px-5 py-2 text-[11px]"
        style={{ borderTop: "1px solid var(--border)", background: "var(--surface-subtle)", color: "var(--fg-faint)" }}
      >
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> to move
        </span>
        <span>
          <kbd>↵</kbd> to open
        </span>
        <span>
          <kbd>esc</kbd> to close
        </span>
        <span className="num ml-auto hidden sm:block">
          {flat.length} {flat.length === 1 ? "result" : "results"}
        </span>
      </div>
    </>
  );
}
