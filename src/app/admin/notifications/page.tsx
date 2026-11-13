import Link from "next/link";
import { Bell, ChevronRight } from "lucide-react";
import NotificationCenter from "@/components/notifications/NotificationCenter";
import NotificationPreferences from "@/components/settings/NotificationPreferences";
import { Panel } from "@/components/ui/cards";
import { findModule } from "@/lib/modules";

export const dynamic = "force-dynamic";

/**
 * Notifications — the full list behind the bell, with what reaches it.
 *
 * Nothing here is fetched separately: the layout builds the notification list
 * once per request and the shell hands it to the bell, the rail badge and this
 * page alike, so a count can never differ between them.
 */
export default function NotificationsPage() {
  const meta = findModule("/admin/notifications");

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="space-y-2">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
          <Link href="/" className="hover:text-[color:var(--fg)]">
            Dashboard
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span>Administration</span>
        </nav>
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]" style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}>
            <Bell className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold leading-tight tracking-tight">{meta?.label ?? "Notifications"}</h1>
            <p className="mt-0.5 max-w-3xl text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
              {meta?.blurb}
            </p>
          </div>
        </div>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <NotificationCenter />

        <div id="preferences" className="grid min-w-0 scroll-mt-4 gap-4">
          <Panel title="Delivery" description="In-app only. Muting a category hides it from the bell, the badge and this list — it does not change the data.">
            <NotificationPreferences />
          </Panel>
          <Panel title="How this works">
            <ul className="space-y-2 text-[12.5px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
              <li>Each item is a record that needs a decision right now — it appears when the data calls for one and leaves when the record is dealt with.</li>
              <li>Read marks and muted categories are kept in this browser; the demo has no accounts to store them against.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
