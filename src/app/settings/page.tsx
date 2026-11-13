import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { MetricTiles, Panel } from "@/components/ui/cards";
import { Pill } from "@/components/ui/primitives";
import { OPERATOR, initials } from "@/lib/operator";
import { effectivePermissions } from "@/lib/permissions";
import { buildNotifications } from "@/server/notifications";
import { databaseBackend, readCollection } from "@/server/store";

export const dynamic = "force-dynamic";

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["Ctrl", "K"], label: "Open the command palette (⌘K on a Mac)" },
  { keys: ["↑", "↓"], label: "Move through palette results" },
  { keys: ["↵"], label: "Open the highlighted result" },
  { keys: ["Esc"], label: "Close a menu or the palette" },
];

/**
 * Settings: who the demo is signed in as, what reaches the bell, and where
 * the workspace reads and writes its data.
 */
export default async function SettingsPage() {
  const dataSource = DATA_SOURCES[databaseBackend()];
  const [notifications, users] = await Promise.all([buildNotifications(), readCollection("users")]);
  const me = users.rows.find((u) => u.email.toLowerCase() === OPERATOR.email);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 py-5 sm:px-6">
      <header>
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
          <Link href="/" className="hover:text-[color:var(--fg)]">
            Dashboard
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span>Administration</span>
        </nav>
        <h1 className="text-[22px] font-bold leading-tight tracking-tight">Settings</h1>
        <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
          Your profile and preferences, and how this workspace is wired.
        </p>
      </header>

      <Section id="account" title="Your account" description="Who this workspace knows you as.">
        <Panel
          title="Profile"
          description="The demo has no sign-in, so this is a fixed operator identity."
          action={me ? { href: `/admin/users/${me.id}`, label: "Open your user record" } : undefined}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[14px] font-bold" style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}>
              {initials(OPERATOR.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold">{OPERATOR.name}</p>
              <p className="truncate text-[12px]" style={{ color: "var(--fg-muted)" }}>
                {OPERATOR.email} · {OPERATOR.team}
              </p>
            </div>
            <Pill tone="brand">{OPERATOR.role}</Pill>
          </div>
          {me && (
            <MetricTiles
              className="mt-3"
              items={[
                { label: "Permissions held", value: String(effectivePermissions(me).length) },
                { label: "Region", value: me.region },
              ]}
            />
          )}
        </Panel>
      </Section>

      <Section id="notifications" title="Notifications" description="What reaches the bell and the sidebar badge.">
        <Panel
          title="Notification centre"
          description="Every open item, with read state and the categories you have muted, lives on its own page."
          action={{ href: "/admin/notifications#preferences", label: "Open notification settings" }}
        >
          <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
            <span className="num font-semibold" style={{ color: "var(--fg)" }}>
              {notifications.length}
            </span>{" "}
            item{notifications.length === 1 ? "" : "s"} need a decision right now.
          </p>
        </Panel>
      </Section>

      <Section id="workspace" title="Workspace" description="Applies to everyone using this deployment.">
        <Panel title="Data source" description="Where screens read from and where changes are written.">
          <dl className="space-y-2.5 text-[12.5px]">
            <Fact label="Reads" value={dataSource.reads} />
            <Fact label="Writes" value={dataSource.writes} />
          </dl>
          <p className="mt-3 text-[12px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            {dataSource.note}
          </p>
        </Panel>
      </Section>

      <Section id="shortcuts" title="Keyboard shortcuts" description="Work without reaching for the mouse.">
        <Panel title="Shortcuts">
          <ul className="grid gap-2 text-[12.5px] sm:grid-cols-2">
            {SHORTCUTS.map(({ keys, label }) => (
              <li key={label} className="flex items-center gap-3 rounded-[10px] px-3 py-2" style={{ background: "var(--surface-subtle)" }}>
                <span className="flex shrink-0 gap-1">
                  {keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </span>
                <span style={{ color: "var(--fg-muted)" }}>{label}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </Section>
    </div>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-4 space-y-2.5">
      <div>
        <h2 id={`${id}-heading`} className="text-[14px] font-semibold">
          {title}
        </h2>
        <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt style={{ color: "var(--fg-muted)" }}>{label}</dt>
      <dd>
        <Pill tone="positive">{value}</Pill>
      </dd>
    </div>
  );
}

const DATA_SOURCES = {
  supabase: {
    reads: "Supabase — sim_* tables",
    writes: "Supabase",
    note: "Every screen reads the shared Supabase project and every change is saved there, in sim_* tables kept apart from the CRM's own. There is no other copy of the data.",
  },
  postgres: {
    reads: "Postgres — sim_* tables",
    writes: "Postgres",
    note: "Every screen reads the sim_* tables in the configured Postgres database (DATABASE_URL) and every change is saved there.",
  },
  memory: {
    reads: "Built-in demo data",
    writes: "Server memory",
    note: "No database is configured, so the demo runs on built-in sample data. Changes are kept until the server restarts, then the demo starts fresh.",
  },
} as const;
