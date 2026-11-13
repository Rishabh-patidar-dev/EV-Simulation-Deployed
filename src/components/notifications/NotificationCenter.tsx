"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, BellOff, CheckCheck, Circle, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import { NOTIFICATION_META, NOTIFICATION_TYPES, type NotificationType } from "@/lib/notifications";
import { NOTIFICATION_ICON } from "@/components/shell/notificationIcons";
import { markRead, markUnread, useNotificationPrefs } from "@/components/shell/notificationPrefs";
import { useShell } from "@/components/shell/ShellContext";

/**
 * The notification centre: every open item across CRM, DMS and ERP, filtered
 * by read state and category. It reads the same list the bell and the rail
 * badge count from, so the three always agree.
 */
export default function NotificationCenter() {
  const { notifications } = useShell();
  const prefs = useNotificationPrefs();
  const [view, setView] = useState<"all" | "unread">("all");
  const [category, setCategory] = useState<NotificationType | null>(null);

  const muted = new Set(prefs.muted);
  const read = new Set(prefs.read);
  const active = notifications.filter((n) => !muted.has(n.type));
  const unreadAll = active.filter((n) => !read.has(n.id));
  const shown = active.filter((n) => (view === "all" || !read.has(n.id)) && (!category || n.type === category));
  const shownUnread = shown.filter((n) => !read.has(n.id));

  const countFor = (type: NotificationType) =>
    active.filter((n) => n.type === type && (view === "all" || !read.has(n.id))).length;

  return (
    <div className="grid gap-4">
      <div className="grid-auto-fit-sm gap-3">
        <Tile label="Unread" value={unreadAll.length} tone={unreadAll.length ? "var(--negative)" : undefined} />
        <Tile label="Open items" value={active.length} />
        <Tile label="Muted categories" value={prefs.muted.length} hint={prefs.muted.length ? `${notifications.length - active.length} items hidden` : "Everything reaches the bell"} />
      </div>

      <section className="surface overflow-hidden" aria-label="Notifications">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <div role="tablist" aria-label="Read state" className="inline-flex rounded-[10px] p-0.5" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
            {(["all", "unread"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className="h-7 rounded-[8px] px-3 text-[12px] font-medium transition-colors"
                style={view === v ? { background: "var(--brand-soft)", color: "var(--brand-ink)" } : { color: "var(--fg-muted)" }}
              >
                {v === "all" ? `All ${active.length}` : `Unread ${unreadAll.length}`}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              markRead(shownUnread.map((n) => n.id));
              toast.success(`${shownUnread.length} marked as read`);
            }}
            disabled={shownUnread.length === 0}
            className="btn btn-ghost btn-sm ml-auto"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark {category ? "these" : "all"} read
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 px-4 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
          <Chip selected={!category} onClick={() => setCategory(null)} label="Every category" count={view === "all" ? active.length : unreadAll.length} />
          {NOTIFICATION_TYPES.filter((t) => !muted.has(t)).map((type) => (
            <Chip
              key={type}
              selected={category === type}
              onClick={() => setCategory(category === type ? null : type)}
              label={NOTIFICATION_META[type].label}
              count={countFor(type)}
            />
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-6 py-14 text-center">
            {view === "unread" ? <CircleCheck className="h-6 w-6" style={{ color: "var(--positive)" }} /> : <Bell className="h-6 w-6" style={{ color: "var(--fg-faint)" }} />}
            <p className="text-[13.5px] font-medium">{view === "unread" ? "Nothing unread here" : "Nothing needs attention here"}</p>
            <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
              {view === "unread" ? "Switch to All to see what you have already read." : "Items appear the moment the data calls for a decision."}
            </p>
          </div>
        ) : (
          <ul>
            {shown.map((n) => {
              const Icon = NOTIFICATION_ICON[n.type];
              const isUnread = !read.has(n.id);
              return (
                <li
                  key={n.id}
                  className="flex items-start gap-3 px-4 py-3 last:border-b-0"
                  style={{ borderBottom: "1px solid var(--border)", ...(isUnread ? { background: "var(--brand-softer)" } : {}) }}
                >
                  <span
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]"
                    style={{ background: "var(--surface-subtle)", color: "var(--fg-muted)", border: "1px solid var(--border)" }}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <Link href={n.href} onClick={() => markRead([n.id])} className="min-w-0 flex-1 outline-none hover:underline focus-visible:underline">
                    <span className={`block text-[13px] leading-snug ${isUnread ? "font-semibold" : "font-medium"}`}>{n.title}</span>
                    <span className="mt-0.5 block text-[12px]" style={{ color: "var(--fg-muted)" }}>
                      {n.message}
                    </span>
                    <span className="mt-1 block text-[11px]" style={{ color: "var(--fg-faint)" }}>
                      {NOTIFICATION_META[n.type].module} · {NOTIFICATION_META[n.type].label} · {n.ago}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => (isUnread ? markRead([n.id]) : markUnread([n.id]))}
                    className="flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-2 text-[11.5px] font-medium transition-colors hover:bg-[color:var(--hover)]"
                    style={{ color: "var(--fg-muted)" }}
                    aria-label={isUnread ? `Mark "${n.title}" as read` : `Mark "${n.title}" as unread`}
                  >
                    {isUnread ? <CheckCheck className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">{isUnread ? "Mark read" : "Mark unread"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {prefs.muted.length > 0 && (
          <p className="flex items-center gap-2 px-4 py-2.5 text-[11.5px]" style={{ borderTop: "1px solid var(--border)", color: "var(--fg-muted)" }}>
            <BellOff className="h-3.5 w-3.5 shrink-0" />
            {prefs.muted.map((t) => NOTIFICATION_META[t].label).join(", ")} {prefs.muted.length === 1 ? "is" : "are"} muted —{" "}
            <a href="#preferences" className="font-semibold hover:underline" style={{ color: "var(--brand-ink)" }}>
              change
            </a>
          </p>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: string }) {
  return (
    <div className="surface px-4 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--fg-faint)" }}>
        {label}
      </p>
      <p className="num mt-2 text-[24px] font-bold leading-none" style={tone ? { color: tone } : undefined}>
        {value}
      </p>
      {hint && (
        <p className="mt-2 text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function Chip({ selected, onClick, label, count }: { selected: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="rounded-full px-3 py-1 text-[12px] font-medium transition-colors"
      style={
        selected
          ? { background: "var(--brand-soft)", color: "var(--brand-ink)", border: "1px solid color-mix(in srgb, var(--brand) 35%, transparent)" }
          : { border: "1px solid var(--border)", color: "var(--fg-muted)" }
      }
    >
      {label} <span className="num opacity-70">{count}</span>
    </button>
  );
}
