import Link from "next/link";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import SubmitButton from "@/components/ui/SubmitButton";
import { StatusPill, formatINR } from "@/components/ui/primitives";
import { filterRows, readQuery } from "@/lib/search";
import { convertLeadToDeal, markLeadLost, updateLeadStatus } from "@/server/actions/crm";
import { readCollection } from "@/server/store";
import type { Lead } from "@/server/types";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS: Lead["status"][] = ["New", "Contacted", "Qualified", "Test Drive", "Converted", "Lost"];

/** Lead Master narrowed to leads that already have an owner and a dealer. */
export default async function AssignedLeadsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ rows }, q] = await Promise.all([readCollection("leads"), readQuery(searchParams)]);
  const assigned = rows.filter((l) => !!l.assignedTo);
  const shown = filterRows(assigned, q);

  const owners = new Set(assigned.map((l) => l.assignedTo));
  const working = assigned.filter((l) => ["Contacted", "Qualified", "Test Drive"].includes(l.status));
  const won = assigned.filter((l) => l.status === "Converted");

  const columns: Column<Lead>[] = [
    {
      key: "name",
      header: "Lead",
      render: (l) => (
        <Link href={`/crm/leads/${l.id}`} className="block hover:underline">
          <span className="block font-medium" style={{ color: "var(--brand-ink)" }}>
            {l.name}
          </span>
          <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
            {l.phone} · {l.city}
          </span>
        </Link>
      ),
    },
    { key: "model", header: "Model", render: (l) => l.model, secondary: true },
    {
      key: "owner",
      header: "Owner",
      secondary: true,
      render: (l) => (
        <span className="block">
          <span className="block">{l.assignedTo}</span>
          <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
            {l.dealer}
          </span>
        </span>
      ),
    },
    { key: "value", header: "Est. value", align: "right", render: (l) => formatINR(l.value), secondary: true },
    { key: "status", header: "Status", render: (l) => <StatusPill value={l.status} /> },
    {
      key: "actions",
      header: "Update",
      render: (l) =>
        l.status === "Converted" || l.status === "Lost" ? (
          <span style={{ color: "var(--fg-faint)" }} className="text-[11.5px]">
            {l.status === "Converted" && l.dealId ? (
              <Link href="/crm/pipeline" className="hover:underline" style={{ color: "var(--brand-ink)" }}>
                View in pipeline
              </Link>
            ) : (
              "Closed"
            )}
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <ActionForm action={updateLeadStatus.bind(null, l.id)} className="flex items-center gap-1.5">
              <select name="status" className="field !w-auto py-1.5 text-[12px]" defaultValue={l.status}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <SubmitButton size="sm" tone="ghost">Set</SubmitButton>
            </ActionForm>
            <ActionForm action={convertLeadToDeal.bind(null, l.id)}>
              <SubmitButton size="sm">Convert</SubmitButton>
            </ActionForm>
            <ActionForm action={markLeadLost.bind(null, l.id)}>
              <SubmitButton size="sm" tone="danger">Lost</SubmitButton>
            </ActionForm>
          </div>
        ),
    },
  ];

  return (
    <ModuleScreen
      href="/crm/leads/assigned"
      searchPlaceholder="Search assigned"
      stats={[
        { label: "Assigned leads", value: String(assigned.length), hint: `${shown.length} shown` },
        { label: "Owners", value: String(owners.size), hint: "Sales staff carrying leads" },
        { label: "Actively worked", value: String(working.length), hint: "Contacted through test drive" },
        { label: "Converted value", value: formatINR(won.reduce((s, l) => s + l.value, 0)), hint: `${won.length} conversions` },
      ]}
    >
      <DataTable rows={shown} columns={columns} empty="No assigned leads match that search." />
    </ModuleScreen>
  );
}
