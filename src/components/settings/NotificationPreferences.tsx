"use client";

import { toast } from "sonner";
import { NOTIFICATION_META, NOTIFICATION_TYPES, type NotificationType } from "@/lib/notifications";
import { setMuted, useNotificationPrefs } from "@/components/shell/notificationPrefs";
import { useShell } from "@/components/shell/ShellContext";

/**
 * Which categories reach the bell, the rail badge and the Notifications list.
 * Saved the moment a box changes — in this browser only, since the demo has
 * no accounts to store it against.
 */
export default function NotificationPreferences() {
  const { muted } = useNotificationPrefs();
  const { notifications } = useShell();
  const mutedSet = new Set(muted);
  const openCount = (type: NotificationType) => notifications.filter((n) => n.type === type).length;

  return (
    <ul className="-mx-1">
      {NOTIFICATION_TYPES.map((type) => {
        const meta = NOTIFICATION_META[type];
        const on = !mutedSet.has(type);
        return (
          <li key={type}>
            <label className="flex cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2.5 transition-colors hover:bg-[color:var(--hover)]">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[13px] font-medium">
                  {meta.label}
                  <span className="pill pill-neutral">{meta.module}</span>
                </span>
                <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                  {meta.description} {openCount(type) ? `${openCount(type)} open right now.` : "Nothing open right now."}
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={on}
                onChange={(event) => {
                  setMuted(type, !event.target.checked);
                  toast.success(event.target.checked ? `${meta.label} will show in the bell` : `${meta.label} muted`);
                }}
                className="h-4 w-4 shrink-0 accent-[color:var(--brand-ink)]"
                aria-label={`Show ${meta.label} in notifications`}
              />
            </label>
          </li>
        );
      })}
    </ul>
  );
}
