import Link from "next/link";
import { integrationTabs } from "@/components/erp/tabs";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, relativeTime } from "@/components/ui/primitives";
import { FilterChips, SimulatedNote, Tabs, withParams } from "@/components/ui/workflow";
import { filterRows } from "@/lib/search";
import { refreshTelematics } from "@/server/actions/integrations";
import { readMany } from "@/server/store";
import type { TelematicsDevice } from "@/server/types";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function Bar({ value, warn }: { value: number; warn: number }) {
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="num w-10 text-right">{value}%</span>
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full sm:block" style={{ background: "var(--bg)" }}>
        <span className="block h-full rounded-full" style={{ width: `${value}%`, background: value < warn ? "var(--negative)" : "var(--brand)" }} />
      </span>
    </span>
  );
}

const COLUMNS: Column<TelematicsDevice>[] = [
  {
    key: "vehicle",
    header: "Vehicle",
    render: (d) => (
      <span className="block">
        <span className="num block font-medium">{d.vin}</span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {d.model} · {d.customer}
        </span>
      </span>
    ),
  },
  { key: "soc", header: "Charge", align: "right", render: (d) => <Bar value={d.soc} warn={20} /> },
  { key: "soh", header: "Battery health", align: "right", render: (d) => <Bar value={Math.round(d.soh)} warn={85} /> },
  { key: "km", header: "Odometer", align: "right", render: (d) => <span className="num whitespace-nowrap">{d.odometerKm.toLocaleString("en-IN")} km</span> },
  { key: "city", header: "Last seen", secondary: true, render: (d) => `${d.city} · ${relativeTime(d.lastSeenAt)}` },
  {
    key: "status",
    header: "Status",
    render: (d) => (
      <span className="flex flex-wrap items-center gap-1">
        <StatusPill value={d.status} />
        {d.alerts
          .filter((a) => a !== "Offline")
          .map((a) => (
            <Pill key={a} tone="warning">
              {a}
            </Pill>
          ))}
      </span>
    ),
  },
  {
    key: "service",
    header: "",
    secondary: true,
    render: (d) => (
      <Link href={`/dms/service/jobcards?vin=${encodeURIComponent(d.vin)}`} className="text-[12px] underline">
        Job card
      </Link>
    ),
  },
];

/** The IoT feed from every delivered vehicle: charge, battery health, distance run, where it was last seen. */
export default async function TelematicsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const filter = one(raw.filter) || undefined;

  const { data } = await readMany(["telematics", "connectors", "messages", "message_templates", "payments"] as const);
  const rows = [...data.telematics].sort((a, b) => b.alerts.length - a.alerts.length || a.soc - b.soc);
  const withAlerts = rows.filter((d) => d.alerts.length > 0);
  const shown = filterRows(rows, q).filter((d) => !filter || (filter === "Alerts" ? d.alerts.length > 0 : d.status === filter));
  const online = rows.filter((d) => d.status === "Online");
  const connector = data.connectors.find((c) => c.key === "telematics");

  return (
    <ModuleScreen
      href="/erp/integrations"
      exportCollection="telematics"
      searchPlaceholder="Search VIN, customer, model or city"
      tabs={
        <Tabs
          current="/erp/integrations/telematics"
          tabs={integrationTabs({ connectors: data.connectors.length, messages: data.messages.length, templates: data.message_templates.length, payments: data.payments.length, devices: rows.length })}
        />
      }
      actions={
        <ActionForm action={refreshTelematics}>
          <SubmitButton tone="ghost">Pull latest readings</SubmitButton>
        </ActionForm>
      }
      stats={[
        { label: "Reporting", value: `${online.length} of ${rows.length}`, hint: connector?.lastEventAt ? `Feed updated ${relativeTime(connector.lastEventAt)}` : "No readings yet" },
        { label: "With an alert", value: String(withAlerts.length), hint: "Low charge, battery health, over-temperature", tone: withAlerts.length ? "warning" : "neutral" },
        { label: "Average battery health", value: rows.length ? `${Math.round(rows.reduce((s, d) => s + d.soh, 0) / rows.length)}%` : "—", hint: "State of health across the fleet" },
        { label: "Fleet distance", value: `${Math.round(rows.reduce((s, d) => s + d.odometerKm, 0) / 1000).toLocaleString("en-IN")}k km`, hint: "Run by delivered vehicles" },
      ]}
    >
      <FilterChips
        total={rows.length}
        current={filter}
        hrefFor={(value) => withParams("/erp/integrations/telematics", { q, filter: value })}
        options={[
          { value: "Online", count: online.length },
          { value: "Offline", count: rows.length - online.length },
          { value: "Alerts", count: withAlerts.length },
        ]}
      />
      <DataTable rows={shown} columns={COLUMNS} empty={q || filter ? "No vehicle matches those filters." : "No devices yet — each vehicle's unit comes online at handover."} />
      <div className="p-4">
        <SimulatedNote>Readings are generated here to stand in for the IoT provider&apos;s feed: distance from the time since the last ping, charge, a slow battery-health decline, and the odd alert.</SimulatedNote>
      </div>
    </ModuleScreen>
  );
}
