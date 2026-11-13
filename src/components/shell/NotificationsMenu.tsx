"use client";

import Link from "next/link";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import { NOTIFICATION_META, type AppNotification } from "@/lib/notifications";
import { NOTIFICATION_ICON } from "./notificationIcons";
import { markRead, useNotificationPrefs } from "./notificationPrefs";
import { usePopover } from "./usePopover";

/** How many the bell lists; the rest are one click away on the Notifications page. */
const BELL_LIMIT = 20;

/** The bell: the latest of everything that needs a human, minus the types this viewer muted. */
export default function NotificationsMenu({ notifications }: { notifications: AppNotification[] }) {
  const { open, setOpen, ref } = usePopover();
  const prefs = useNotificationPrefs();

  const muted = new Set(prefs.muted);
  const read = new Set(prefs.read);
  const visible = notifications.filter((n) => !muted.has(n.type));
  const unread = visible.filter((n) => !read.has(n.id));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-popover-trigger
        onClick={() => setOpen((o) => !o)}
        className="icon-btn"
        aria-label={unread.length ? `Notifications, ${unread.length} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell className="h-4 w-4" />
        {unread.length > 0 && (
          <span
            className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white"
            style={{ background: "#d93025", border: "2px solid var(--card)" }}
          >
            {unread.length > 99 ? "99+" : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="popover fixed inset-x-4 top-[4.25rem] z-50 flex flex-col overflow-hidden sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[23rem]"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <p className="flex items-center gap-2 text-[13.5px] font-semibold">
              Notifications
              {unread.length > 0 && <span className="pill pill-neutral num">{unread.length} new</span>}
            </p>
            {unread.length > 0 && (
              <button
                type="button"
                onClick={() => markRead(unread.map((n) => n.id))}
                className="flex items-center gap-1 rounded-[6px] text-[12px] font-semibold outline-none hover:opacity-80 focus-visible:underline"
                style={{ color: "var(--brand-ink)" }}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[min(26rem,65svh)] overflow-y-auto overscroll-contain">
            {visible.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
                {notifications.length === 0 ? (
                  <Bell className="h-5 w-5" style={{ color: "var(--fg-faint)" }} />
                ) : (
                  <BellOff className="h-5 w-5" style={{ color: "var(--fg-faint)" }} />
                )}
                <p className="text-[13px] font-medium">{notifications.length === 0 ? "You are all caught up" : "Everything here is muted"}</p>
                <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
                  {notifications.length === 0
                    ? "Late orders, overdue invoices, expired licences and stale approvals will appear here."
                    : "Turn categories back on in notification settings."}
                </p>
              </div>
            ) : (
              <ul>
                {visible.slice(0, BELL_LIMIT).map((n) => {
                  const Icon = NOTIFICATION_ICON[n.type];
                  const isUnread = !read.has(n.id);
                  return (
                    <li key={n.id} style={{ borderBottom: "1px solid var(--border)" }} className="last:border-b-0">
                      <Link
                        href={n.href}
                        onClick={() => {
                          markRead([n.id]);
                          setOpen(false);
                        }}
                        className="flex items-start gap-3 px-4 py-3 outline-none transition-colors hover:bg-[color:var(--hover)] focus-visible:bg-[color:var(--hover)]"
                        style={isUnread ? { background: "var(--brand-softer)" } : undefined}
                      >
                        <span
                          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]"
                          style={{ background: "var(--surface-subtle)", color: "var(--fg-muted)", border: "1px solid var(--border)" }}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-[12.5px] leading-snug ${isUnread ? "font-semibold" : "font-medium"}`}>{n.title}</span>
                          <span className="mt-0.5 block truncate text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                            {n.message}
                          </span>
                          <span className="mt-1 block text-[11px]" style={{ color: "var(--fg-faint)" }}>
                            {NOTIFICATION_META[n.type].module} · {n.ago}
                          </span>
                        </span>
                        {isUnread && <span aria-label="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--brand)" }} />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: "1px solid var(--border)" }}>
            <Link
              href="/admin/notifications"
              onClick={() => setOpen(false)}
              className="text-[12px] font-semibold outline-none hover:underline focus-visible:underline"
              style={{ color: "var(--brand-ink)" }}
            >
              {visible.length > BELL_LIMIT ? `View all ${visible.length}` : "View all notifications"}
            </Link>
            <Link
              href="/admin/notifications#preferences"
              onClick={() => setOpen(false)}
              className="text-[12px] font-medium outline-none hover:underline focus-visible:underline"
              style={{ color: "var(--fg-muted)" }}
            >
              Settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
