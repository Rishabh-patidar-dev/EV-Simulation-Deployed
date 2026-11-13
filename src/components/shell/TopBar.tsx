"use client";

import { Menu } from "lucide-react";
import type { AppNotification } from "@/lib/notifications";
import type { StatusGroup } from "@/lib/status";
import NotificationsMenu from "./NotificationsMenu";
import ProfileMenu from "./ProfileMenu";
import StatusMenu from "./StatusMenu";

/**
 * The strip above every page: on phones the nav trigger and workspace name
 * (the rail carries both on desktop); system status, notifications and the
 * account menu on the right. Search lives in the rail and on Ctrl/⌘ K.
 */
export default function TopBar({
  onOpenNav,
  notifications,
  status,
}: {
  onOpenNav: () => void;
  notifications: AppNotification[];
  status: StatusGroup[];
}) {
  return (
    <header
      className="flex h-16 shrink-0 items-center gap-3 px-4 sm:px-6 print:hidden"
      style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}
    >
      <button type="button" onClick={onOpenNav} className="icon-btn lg:hidden" aria-label="Open navigation">
        <Menu className="h-4 w-4" />
      </button>

      <div className="min-w-0 lg:hidden">
        <p className="truncate text-[14px] font-semibold leading-tight">Luxus Green Operations</p>
        <p className="hidden truncate text-[11.5px] leading-tight sm:block" style={{ color: "var(--fg-muted)" }}>
          CRM, DMS and ERP on one dashboard
        </p>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <StatusMenu groups={status} />
        <NotificationsMenu notifications={notifications} />
        <ProfileMenu />
      </div>
    </header>
  );
}
