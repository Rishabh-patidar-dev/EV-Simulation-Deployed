import AreaChart from "@/components/charts/AreaChart";
import DonutChart from "@/components/charts/DonutChart";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Icon from "@/components/ui/Icon";
import { Card, CardHeader, formatINR } from "@/components/ui/primitives";
import { findModule } from "@/lib/modules";
import { buildDashboard } from "@/server/analytics";
import { readMany } from "@/server/store";

export const dynamic = "force-dynamic";

interface StateRow {
  state: string;
  dealers: number;
  ytdUnits: number;
  target: number;
  outstanding: number;
}

const STATE_COLUMNS: Column<StateRow>[] = [
  { key: "state", header: "State", render: (r) => <span className="font-medium">{r.state}</span> },
  { key: "dealers", header: "Dealers", align: "right", render: (r) => r.dealers },
  { key: "units", header: "YTD units", align: "right", render: (r) => r.ytdUnits },
  { key: "target", header: "Target", align: "right", render: (r) => r.target, secondary: true },
  {
    key: "pct",
    header: "Achievement",
    align: "right",
    render: (r) => {
      const pct = Math.round((r.ytdUnits / Math.max(1, r.target)) * 100);
      return <span style={{ color: pct >= 100 ? "var(--positive)" : undefined }}>{pct}%</span>;
    },
  },
  { key: "out", header: "Outstanding", align: "right", render: (r) => formatINR(r.outstanding) },
];

/**
 * The MIS view: the same figures the dashboard shows, but cut by geography
 * and by line of business rather than by day.
 */
export default async function AnalyticsPage() {
  const meta = findModule("/erp/analytics");
  const [d, { data }] = await Promise.all([buildDashboard(), readMany(["dealers"] as const)]);

  const byState = Object.values(
    data.dealers.reduce<Record<string, StateRow>>((acc, dealer) => {
      const row = (acc[dealer.state] ??= { state: dealer.state, dealers: 0, ytdUnits: 0, target: 0, outstanding: 0 });
      row.dealers += 1;
      row.ytdUnits += dealer.ytdUnits;
      row.target += dealer.targetUnits;
      row.outstanding += dealer.outstanding;
      return acc;
    }, {})
  ).sort((a, b) => b.ytdUnits - a.ytdUnits);

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6">
      <header className="mb-5 flex items-start gap-3">
        <span
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
          style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}
        >
          <Icon name="BarChart3" className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-tight tracking-tight">{meta?.label}</h1>
          <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
            {meta?.blurb}
          </p>
        </div>
      </header>

      <div className="grid min-w-0 gap-4">
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Card className="min-w-0">
            <CardHeader title="Revenue mix" subtitle="Invoiced value by line of business" />
            <div className="px-5 pb-6 pt-1">
              <DonutChart data={d.revenueMix} centerLabel="Total invoiced" format="inr" />
            </div>
          </Card>
          <Card className="min-w-0">
            <CardHeader title="Lead funnel" subtitle="Leads by current status" />
            <div className="px-5 pb-6 pt-1">
              <DonutChart data={d.leadFunnel} centerLabel="Leads" />
            </div>
          </Card>
        </div>

        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
          <Card className="min-w-0">
            <CardHeader title="Order intake vs. billing" subtitle="Last 7 days" />
            <div className="px-4 pb-4">
              <AreaChart data={d.series} />
            </div>
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <CardHeader title="Territory performance" subtitle="Dealer network by state" />
            <DataTable rows={byState} columns={STATE_COLUMNS} />
          </Card>
        </div>
      </div>
    </div>
  );
}
