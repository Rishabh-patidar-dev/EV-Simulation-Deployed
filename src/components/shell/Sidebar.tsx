"use client";

import { useState, type ReactNode, type SyntheticEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { RAIL_SECTIONS, type ModuleGroup, type ModuleLeaf } from "@/lib/modules";
import Icon from "@/components/ui/Icon";
import { useNotificationPrefs } from "./notificationPrefs";
import { useShell } from "./ShellContext";
import { useShortcutLabel } from "./useShortcutLabel";

/**
 * The rail. Rendered straight off lib/modules.ts, so the client's module list
 * and what the sidebar shows can never drift apart.
 *
 * On desktop it expands to 276px or collapses to a 64px icon strip (with
 * tooltips); below `lg` it is an off-canvas drawer that is always expanded.
 * Groups behave as an accordion — one open at a time — and open by
 * themselves when the current page is inside them.
 */

type Tip = { label: string; top: number; left: number } | null;

const NOTIFICATIONS_HREF = "/admin/notifications";

const LEAVES = RAIL_SECTIONS.flatMap((s) => s.nodes.flatMap((n) => (n.kind === "leaf" ? [n] : n.children)));

/**
 * The module the current page belongs to: an exact match, else the longest
 * module path it sits under — so /crm/leads/LEAD-0001 lights up Lead Master,
 * while /crm/leads/assigned still matches only Assigned Leads.
 */
function activeHref(pathname: string): string | null {
  if (pathname === "/") return "/";
  let best: string | null = null;
  for (const leaf of LEAVES) {
    if (pathname === leaf.href) return leaf.href;
    if (pathname.startsWith(`${leaf.href}/`) && (!best || leaf.href.length > best.length)) best = leaf.href;
  }
  return best;
}

function groupContaining(href: string | null): string | null {
  if (!href) return null;
  for (const section of RAIL_SECTIONS) {
    for (const node of section.nodes) {
      if (node.kind === "group" && node.children.some((c) => c.href === href)) return node.id;
    }
  }
  return null;
}

export default function Sidebar({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname() ?? "/";
  const { collapsed: railCollapsed, setCollapsed, openPalette, notifications } = useShell();
  const collapsed = !mobile && railCollapsed;
  const shortcut = useShortcutLabel();

  // Same count as the bell: unread, in categories this viewer has not muted.
  const prefs = useNotificationPrefs();
  const muted = new Set(prefs.muted);
  const read = new Set(prefs.read);
  const unread = notifications.filter((n) => !muted.has(n.type) && !read.has(n.id)).length;
  const badgeFor = (href: string) => (href === NOTIFICATIONS_HREF && unread > 0 ? unread : undefined);

  const current = activeHref(pathname);
  const currentGroup = groupContaining(current);

  // Follows the route, but a click wins until the next navigation. Adjusted
  // during render rather than in an effect, so there is no extra paint.
  const [openGroup, setOpenGroup] = useState<string | null>(currentGroup);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (currentGroup) setOpenGroup(currentGroup);
  }

  const [tip, setTip] = useState<Tip>(null);
  const tipFor = (label: string): TipHandlers => {
    const show = (event: SyntheticEvent<HTMLElement>) => {
      if (!collapsed) return;
      const rect = event.currentTarget.getBoundingClientRect();
      setTip({ label, top: rect.top + rect.height / 2, left: rect.right + 10 });
    };
    const hide = () => setTip(null);
    return { onPointerEnter: show, onPointerLeave: hide, onFocus: show, onBlur: hide };
  };

  const toggleGroup = (id: string) => {
    setTip(null);
    if (collapsed) {
      // An icon-only group has nowhere to open into — widen the rail first.
      setCollapsed(false);
      setOpenGroup(id);
      return;
    }
    setOpenGroup((open) => (open === id ? null : id));
  };

  return (
    <aside
      className="rail flex h-full shrink-0 flex-col"
      style={{ width: collapsed ? 64 : 276 }}
      data-collapsed={collapsed}
      aria-label="Main navigation"
    >
      {/* ── brand ─────────────────────────────────────────────────────── */}
      <div
        className={`flex h-16 shrink-0 items-center gap-2.5 ${collapsed ? "justify-center px-2" : "px-4"}`}
        style={{ borderBottom: "1px solid var(--sidebar-border)" }}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={() => {
              setTip(null);
              setCollapsed(false);
            }}
            className="rail-item"
            aria-label="Expand navigation"
            {...tipFor("Expand navigation")}
          >
            <PanelLeftOpen className="h-[18px] w-[18px]" />
          </button>
        ) : (
          <>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/luxus-green-logo.webp" alt="Luxus Green Mobility" className="h-7 w-7 object-contain" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold leading-tight tracking-tight">Luxus Green</span>
              <span className="block truncate text-[11px] leading-tight" style={{ color: "var(--fg-faint)" }}>
                CRM · DMS · ERP simulation
              </span>
            </span>
            <button
              type="button"
              onClick={mobile ? onNavigate : () => setCollapsed(true)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] transition-colors hover:bg-[color:var(--hover)]"
              style={{ color: "var(--fg-muted)" }}
              aria-label={mobile ? "Close navigation" : "Collapse navigation"}
              title={mobile ? "Close navigation" : "Collapse navigation"}
            >
              {mobile ? <X className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
            </button>
          </>
        )}
      </div>

      {/* ── search / command palette ──────────────────────────────────── */}
      <div className={collapsed ? "px-2 py-3" : "px-3 py-3"} style={{ borderBottom: "1px solid var(--sidebar-border)" }}>
        <button
          type="button"
          onClick={() => {
            setTip(null);
            openPalette();
          }}
          aria-label="Search pages and actions"
          aria-keyshortcuts="Meta+K Control+K"
          className={`flex h-9 w-full items-center gap-2 rounded-[10px] text-[13px] outline-none transition-colors hover:bg-[color:var(--hover)] focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--brand)_45%,transparent)] ${
            collapsed ? "justify-center" : "px-2.5"
          }`}
          style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--fg-muted)" }}
          {...tipFor(shortcut ? `Search · ${shortcut}` : "Search")}
        >
          <Search className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-left">Search or jump to…</span>
              {shortcut && <kbd>{shortcut}</kbd>}
            </>
          )}
        </button>
      </div>

      {/* ── modules ───────────────────────────────────────────────────── */}
      <nav
        className={`no-scrollbar min-h-0 flex-1 overflow-y-auto py-3 ${collapsed ? "px-2" : "px-3"}`}
        onScroll={() => setTip(null)}
        aria-label="Modules"
      >
        <div className="rail-section">
          <RailLink
            href="/"
            label="Dashboard"
            icon={<LayoutDashboard className="h-[17px] w-[17px] shrink-0" />}
            active={current === "/"}
            collapsed={collapsed}
            onNavigate={onNavigate}
            tip={tipFor("Dashboard")}
          />
        </div>

        {RAIL_SECTIONS.map((section) => (
          <div key={section.id} className="rail-section">
            {!collapsed && <p className="rail-heading px-2.5 pb-1.5">{section.label}</p>}
            <div className="flex flex-col gap-0.5">
              {section.nodes.map((node) =>
                node.kind === "leaf" ? (
                  <LeafLink
                    key={node.href}
                    module={node}
                    active={current === node.href}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                    badge={badgeFor(node.href)}
                    tip={tipFor(
                      badgeFor(node.href)
                        ? `${node.label} · ${badgeFor(node.href)} unread`
                        : node.underDevelopment
                          ? `${node.label} · under development`
                          : node.label,
                    )}
                  />
                ) : (
                  <GroupBlock
                    key={node.id}
                    group={node}
                    open={!collapsed && openGroup === node.id}
                    current={current}
                    collapsed={collapsed}
                    onToggle={() => toggleGroup(node.id)}
                    onNavigate={onNavigate}
                    tip={tipFor(node.label)}
                  />
                )
              )}
            </div>
          </div>
        ))}
      </nav>

      {tip && (
        <div role="tooltip" className="rail-tip" style={{ top: tip.top, left: tip.left }}>
          {tip.label}
        </div>
      )}
    </aside>
  );
}

interface TipHandlers {
  onPointerEnter: (event: SyntheticEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onFocus: (event: SyntheticEvent<HTMLElement>) => void;
  onBlur: () => void;
}

/** Children of an open group are only ever shown with the rail expanded, so they never need a tooltip. */
const NO_TIP: TipHandlers = { onPointerEnter: () => {}, onPointerLeave: () => {}, onFocus: () => {}, onBlur: () => {} };

function RailLink({
  href,
  label,
  icon,
  active,
  collapsed,
  onNavigate,
  tip,
  nested = false,
  badge,
  dev = false,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
  tip: TipHandlers;
  nested?: boolean;
  /** A count shown at the end of the row — unread notifications. */
  badge?: number;
  /** Marks a module still waiting on its live integration. */
  dev?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`rail-item relative ${nested ? "rail-sub" : ""}`}
      data-active={active}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed || dev ? `${label}${dev ? ", under development" : ""}${badge ? `, ${badge} unread` : ""}` : undefined}
      {...tip}
    >
      {icon}
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {dev &&
        (collapsed ? (
          <span aria-hidden className="dev-dot absolute right-2 bottom-1.5" style={{ height: 6, width: 6, boxShadow: "none" }} />
        ) : (
          <span aria-hidden className="dev-dot" />
        ))}
      {badge !== undefined &&
        (collapsed ? (
          <span aria-hidden className="absolute right-2 top-1.5 h-2 w-2 rounded-full" style={{ background: "#d93025", boxShadow: "0 0 0 2px var(--sidebar)" }} />
        ) : (
          <span
            className="num flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none text-white"
            style={{ background: "#d93025" }}
            aria-label={`${badge} unread`}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        ))}
    </Link>
  );
}

function LeafLink({
  module,
  active,
  collapsed,
  onNavigate,
  tip,
  nested = false,
  badge,
}: {
  module: ModuleLeaf;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
  tip: TipHandlers;
  nested?: boolean;
  badge?: number;
}) {
  return (
    <RailLink
      href={module.href}
      label={module.label}
      icon={<Icon name={module.icon} className={nested ? "h-[15px] w-[15px] shrink-0" : "h-[17px] w-[17px] shrink-0"} />}
      active={active}
      collapsed={collapsed}
      onNavigate={onNavigate}
      tip={tip}
      nested={nested}
      badge={badge}
      dev={module.underDevelopment}
    />
  );
}

function GroupBlock({
  group,
  open,
  current,
  collapsed,
  onToggle,
  onNavigate,
  tip,
}: {
  group: ModuleGroup;
  open: boolean;
  current: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  tip: TipHandlers;
}) {
  const panelId = `rail-group-${group.id}`;
  const containsActive = group.children.some((c) => c.href === current);
  // Only while the children are out of sight — open, each one carries its own dot.
  const hidesDev = group.children.some((c) => c.underDevelopment) && (collapsed || !open);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="rail-item relative"
        // Collapsed, the group icon is the only mark the current page has.
        data-active={collapsed && containsActive}
        data-contains-active={!collapsed && containsActive && !open}
        aria-expanded={collapsed ? undefined : open}
        aria-controls={collapsed ? undefined : panelId}
        aria-label={
          collapsed || hidesDev
            ? `${group.label}${hidesDev ? ", contains a module under development" : ""}${collapsed ? " — expand navigation" : ""}`
            : undefined
        }
        {...tip}
      >
        <Icon name={group.icon} className="h-[17px] w-[17px] shrink-0" />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
            {hidesDev && <span aria-hidden className="dev-dot" />}
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
              style={{ color: "var(--fg-faint)" }}
            />
          </>
        )}
        {collapsed && hidesDev && <span aria-hidden className="dev-dot absolute right-2 bottom-1.5" style={{ height: 6, width: 6, boxShadow: "none" }} />}
      </button>

      {!collapsed && (
        <div id={panelId} className="rail-children" data-open={open}>
          <div>
            <div className="rail-children-inner" inert={!open}>
              {group.children.map((child) => (
                <LeafLink
                  key={child.href}
                  module={child}
                  active={current === child.href}
                  collapsed={false}
                  onNavigate={onNavigate}
                  tip={NO_TIP}
                  nested
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
