import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  Car,
  CircleDot,
  ClipboardCheck,
  FileSpreadsheet,
  Kanban,
  Receipt,
  ShoppingCart,
  UserCog,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import AreaChart from "@/components/charts/AreaChart";
import DonutChart from "@/components/charts/DonutChart";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { MagnitudeBars, MetricCard, MetricTiles, ModuleCard, Panel, RatioGauge } from "@/components/ui/cards";
import { StatusPill, formatINR, relativeTime } from "@/components/ui/primitives";
import RefreshButton from "@/components/ui/RefreshButton";
import { OPERATOR } from "@/lib/operator";
import { buildDashboard, type RecentInvoiceRow, type StatTile } from "@/server/analytics";

export const dynamic = "force-dynamic";

/**
 * The single dashboard.
 *
 * Everything on this page is derived from the same collections the module
 * screens read (see server/analytics.ts) — the whole pitch of the simulation
 * is that a lead captured in CRM, an order raised in DMS and an invoice
 * settled in ERP all land on one screen and agree with each other.
 */
export default async function DashboardPage() {
  const d = await buildDashboard();

  const intake7 = d.series.reduce((s, p) => s + p.intake, 0);
  const billed7 = d.series.reduce((s, p) => s + p.billed, 0);
  const funnelPeak = Math.max(1, ...d.leadFunnel.map((s) => s.value));
  const peakDay = d.series.reduce((best, p) => (p.billed > best.billed ? p : best), d.series[0]);

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
            {greeting()}, {OPERATOR.firstName}
          </p>
          <h1 className="text-[24px] font-bold leading-tight tracking-tight">Network overview</h1>
        </div>
        <RefreshButton />
      </header>

      {/* ── headline numbers ─────────────────────────────────────────── */}
      <section aria-label="Headline figures" className="grid-auto-fit-sm gap-3">
        {d.tiles.map((tile) => (
          <KpiCard key={tile.key} tile={tile} />
        ))}
      </section>

      {/* ── workspaces ───────────────────────────────────────────────── */}
      <section aria-labelledby="workspaces-heading" className="space-y-2.5">
        <div>
          <h2 id="workspaces-heading" className="text-[14px] font-semibold">
            Workspaces
          </h2>
          <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
            Jump into a module and carry on where the numbers point.
          </p>
        </div>
        <div className="grid-auto-fit items-stretch gap-3">
          {d.workspaces.map((w) => (
            <ModuleCard key={w.key} title={w.title} detail={w.detail} href={w.href} icon={WORKSPACE_ICON[w.key] ?? CircleDot} />
          ))}
        </div>
      </section>

      {/* ── intake vs billing, and what was billed ───────────────────── */}
      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Panel
          title="Order intake vs. billing"
          description="Dealer orders raised against invoices issued, over the last seven days."
          action={{ href: "/dms/orders", label: "Open Order Management" }}
        >
          <AreaChart data={d.series} />
          <MetricTiles
            className="mt-3"
            columns={3}
            items={[
              { label: "Ordered, 7 days", value: formatINR(intake7) },
              { label: "Billed, 7 days", value: formatINR(billed7) },
              { label: "Peak billing day", value: peakDay.billed ? peakDay.label : "—" },
            ]}
          />
        </Panel>

        <Panel title="Revenue mix" description="Invoiced value by line of business." action={{ href: "/dms/orders/invoices", label: "Billing & invoices" }}>
          <div className="m-auto w-full max-w-md">
            <DonutChart data={d.revenueMix} centerLabel="Total invoiced" format="inr" />
          </div>
        </Panel>
      </div>

      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <Panel title="Network health" description="Average health score across active dealers." action={{ href: "/dms/dealers", label: "Open Dealer 360" }}>
          <div className="grid items-center gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
            <RatioGauge
              value={d.networkHealth.score}
              emphasis={d.networkHealth.score < 70 ? "warning" : "neutral"}
              caption={<span className="font-semibold" style={{ color: "var(--brand-ink)" }}>{d.networkHealth.label}</span>}
            />
            <div className="min-w-0 space-y-2">
              <p className="menu-label">Top performers</p>
              {d.topDealers.map((dealer) => (
                <div key={dealer.code} className="rounded-[12px] px-3.5 py-3" style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold">{dealer.name}</span>
                      <span className="block text-[11px] opacity-80">
                        {dealer.code} · {dealer.city}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: "var(--card)" }}>
                      {dealer.tier}
                    </span>
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <span className="num text-[18px] font-bold leading-none">
                      {dealer.ytdUnits}
                      <span className="text-[11.5px] font-medium opacity-70"> / {dealer.targetUnits} units</span>
                    </span>
                    <span className="text-[11px] opacity-80">Outstanding {formatINR(dealer.outstanding)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="Target progress" description="Year-to-date units against annual target, largest targets first." action={{ href: "/dms/dealers", label: "All dealer targets" }}>
          <MagnitudeBars
            max={100}
            data={d.targets.map((t) => {
              const pct = Math.round((t.achieved / Math.max(1, t.target)) * 100);
              return {
                key: t.code,
                label: t.label,
                value: pct,
                display: `${pct}%`,
                meta: `${t.achieved} of ${t.target} units`,
                muted: pct < 85,
              };
            })}
          />
          <p className="mt-3 text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
            Green bars are at or above 85% of target; orange ones are behind.
          </p>
        </Panel>

        <Panel
          title="Recent invoices"
          description="Raised against dealer orders."
          action={{ href: "/dms/orders/invoices", label: "All invoices" }}
          bodyClassName="p-0!"
        >
          <DataTable rows={d.recentInvoices} columns={INVOICE_COLUMNS} />
        </Panel>

        <Panel
          title="Needs attention"
          description="Open items across every module."
          headerExtra={<span className="pill pill-warning num">{d.attention.reduce((s, a) => s + a.count, 0)} open</span>}
          bodyClassName="px-2! py-2!"
        >
          {d.attention.length === 0 ? (
            <p className="m-auto py-8 text-center text-[13px]" style={{ color: "var(--fg-muted)" }}>
              Nothing needs a decision right now.
            </p>
          ) : (
            <ul>
              {d.attention.map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[12.5px] transition-colors hover:bg-[color:var(--hover)]"
                  >
                    <CircleDot className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--viz-3)" }} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="num shrink-0 font-semibold">{item.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Lead funnel" description="Where every captured lead currently sits." action={{ href: "/crm/leads", label: "Open Lead Master" }}>
        <div className="grid-auto-fit-sm gap-2">
          {d.leadFunnel.map((stage, i) => (
            <div key={stage.label} className="rounded-[10px] px-3 py-3" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
              <p className="num text-[22px] font-bold leading-none">{stage.value}</p>
              <p className="mt-1.5 text-[12px]" style={{ color: "var(--fg-muted)" }}>
                {stage.label}
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
                <div className="h-full rounded-full" style={{ width: `${(stage.value / funnelPeak) * 100}%`, background: `var(--viz-${(i % 6) + 1})` }} />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Recent activity" description="The latest events across CRM, DMS and ERP.">
        <ul className="grid gap-x-6 gap-y-3.5 md:grid-cols-2 2xl:grid-cols-3">
          {d.activity.map((item, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: ACTIVITY_COLOR[item.kind] }} />
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium">{item.title}</span>
                <span className="block truncate text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                  {item.detail}
                </span>
                <span className="block text-[11px]" style={{ color: "var(--fg-faint)" }}>
                  {relativeTime(item.at)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

const TILE_ICON: Record<string, LucideIcon> = {
  billed: Receipt,
  receivables: Wallet,
  pipeline: Kanban,
  bookings: ClipboardCheck,
};

const WORKSPACE_ICON: Record<string, LucideIcon> = {
  leads: Users,
  pipeline: Kanban,
  dealers: Building2,
  stock: Car,
  orders: ShoppingCart,
  billing: Receipt,
  retail: FileSpreadsheet,
  rto: BadgeCheck,
  aftersales: Wrench,
  access: UserCog,
};

const ACTIVITY_COLOR: Record<string, string> = {
  lead: "var(--viz-1)",
  order: "var(--viz-2)",
  invoice: "var(--viz-3)",
  claim: "var(--viz-5)",
  onboarding: "var(--viz-4)",
};

const INVOICE_COLUMNS: Column<RecentInvoiceRow>[] = [
  { key: "no", header: "Invoice", render: (r) => <span className="font-medium">{r.invoiceNo}</span> },
  { key: "dealer", header: "Dealer", render: (r) => r.dealer },
  { key: "type", header: "Type", render: (r) => r.type, secondary: true },
  { key: "amount", header: "Amount", align: "right", render: (r) => formatINR(r.amount) },
  { key: "status", header: "Status", render: (r) => <StatusPill value={r.status} /> },
];

/** A headline tile: the trend reads green or red by whether rising is good news for that figure. */
function KpiCard({ tile }: { tile: StatTile }) {
  const up = tile.delta >= 0;
  const good = up === tile.goodWhenUp || tile.delta === 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <MetricCard
      label={tile.label}
      value={tile.value}
      icon={TILE_ICON[tile.key]}
      href={tile.href}
      tone={good ? "neutral" : "negative"}
      hint={
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span className="inline-flex items-center gap-0.5 font-semibold" style={{ color: good ? "var(--positive)" : "var(--negative)" }}>
            <Arrow className="h-3.5 w-3.5" />
            {Math.abs(tile.delta)}%
          </span>
          <span style={{ color: "var(--fg-muted)" }}>{tile.deltaLabel}</span>
        </span>
      }
    />
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
