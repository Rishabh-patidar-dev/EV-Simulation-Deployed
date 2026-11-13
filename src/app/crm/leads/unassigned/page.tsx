import Link from "next/link";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import SubmitButton from "@/components/ui/SubmitButton";
import { StatusPill, daysSince, formatINR, relativeTime } from "@/components/ui/primitives";
import { filterRows, readQuery } from "@/lib/search";
import { assignLead } from "@/server/actions/crm";
import { routeAllUnassigned, routeLead } from "@/server/actions/leads";
import { nearestDealer } from "@/lib/leads";
import { assignableStaff } from "@/server/staff";
import { readMany } from "@/server/store";
import type { Lead } from "@/server/types";

export const dynamic = "force-dynamic";

/** Same register as Lead Master, narrowed to the leads nobody owns yet. */
export default async function UnassignedLeadsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ data }, q, staff] = await Promise.all([readMany(["leads", "dealers"] as const), readQuery(searchParams), assignableStaff("leads.manage")]);
  const dealerNames = data.dealers.filter((d) => d.status === "Active").map((d) => d.name);
  const unassigned = data.leads.filter((l) => !l.assignedTo);
  // Highest score first — the order routing works through them.
  const shown = filterRows(unassigned, q).sort((a, b) => b.score - a.score);
  const routable = unassigned.filter((l) => l.status !== "Lost" && l.status !== "Converted" && nearestDealer(l, data.dealers, data.leads)).length;

  const stale = unassigned.filter((l) => daysSince(l.createdAt) > 3);
  const hot = unassigned.filter((l) => l.score >= 75);

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
    { key: "source", header: "Source", render: (l) => l.source, secondary: true },
    { key: "status", header: "Status", render: (l) => <StatusPill value={l.status} /> },
    { key: "score", header: "Score", align: "right", render: (l) => l.score },
    { key: "value", header: "Est. value", align: "right", render: (l) => formatINR(l.value), secondary: true },
    { key: "age", header: "Waiting", align: "right", secondary: true, render: (l) => relativeTime(l.createdAt) },
    {
      key: "nearest",
      header: "Nearest dealer",
      secondary: true,
      render: (l) => {
        const match = nearestDealer(l, data.dealers, data.leads);
        return match ? (
          <ActionForm action={routeLead.bind(null, l.id)} className="flex items-center gap-1.5">
            <span className="block min-w-0">
              <span className="block truncate">{match.dealer.name}</span>
              <span className="block text-[11px]" style={{ color: "var(--fg-muted)" }}>
                {match.why}
              </span>
            </span>
            <SubmitButton size="sm" tone="ghost">
              Route
            </SubmitButton>
          </ActionForm>
        ) : (
          <span className="text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
            No dealer in {l.city}
            {l.state ? ` or ${l.state}` : ""}
          </span>
        );
      },
    },
    {
      key: "assign",
      header: "Assign by hand",
      render: (l) => (
        <ActionForm action={assignLead.bind(null, l.id)} className="flex items-center gap-1.5">
          <select name="assignedTo" required className="field !w-auto py-1.5 text-[12px]" defaultValue="">
            <option value="" disabled>Owner…</option>
            {staff.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select name="dealer" required className="field !w-auto py-1.5 text-[12px]" defaultValue="">
            <option value="" disabled>Dealer…</option>
            {dealerNames.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <SubmitButton size="sm">Assign</SubmitButton>
        </ActionForm>
      ),
    },
  ];

  return (
    <ModuleScreen
      href="/crm/leads/unassigned"
      searchPlaceholder="Search unassigned"
      stats={[
        { label: "Unassigned", value: String(unassigned.length), hint: `${shown.length} shown` },
        { label: "Waiting over 3 days", value: String(stale.length), hint: "Past the routing SLA" },
        { label: "High score (75+)", value: String(hot.length), hint: "Route these first" },
        { label: "Value at stake", value: formatINR(unassigned.reduce((s, l) => s + l.value, 0)), hint: "Estimated deal value" },
      ]}
      actions={
        routable ? (
          <ActionForm action={routeAllUnassigned}>
            <SubmitButton>Route all {routable} to nearest dealers</SubmitButton>
          </ActionForm>
        ) : undefined
      }
    >
      <DataTable rows={shown} columns={columns} empty="Every lead has an owner — nothing waiting to be routed." />
    </ModuleScreen>
  );
}
