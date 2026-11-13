import Link from "next/link";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { StatusPill, formatINR, relativeTime } from "@/components/ui/primitives";
import { VEHICLE_MODELS } from "@/lib/vehicles";
import { filterRows, readQuery } from "@/lib/search";
import { createLead } from "@/server/actions/crm";
import { importLeads } from "@/server/actions/leads";
import { Hint } from "@/components/ui/workflow";
import { INDIAN_STATES } from "@/lib/gst";
import { assignableStaff } from "@/server/staff";
import { readMany } from "@/server/store";
import type { Lead } from "@/server/types";

export const dynamic = "force-dynamic";

export const LEAD_COLUMNS: Column<Lead>[] = [
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
  {
    key: "owner",
    header: "Owner",
    secondary: true,
    render: (l) =>
      l.assignedTo ? (
        <span className="block">
          <span className="block">{l.assignedTo}</span>
          <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
            {l.dealer}
          </span>
        </span>
      ) : (
        <span style={{ color: "var(--fg-faint)" }}>Unassigned</span>
      ),
  },
  {
    key: "score",
    header: "Score",
    align: "right",
    render: (l) => (
      <span title={l.scoreBreakdown?.missing.length ? `Missing: ${l.scoreBreakdown.missing.join(", ")}` : undefined} style={{ color: l.score >= 75 ? "var(--positive)" : l.score < 40 ? "var(--fg-faint)" : undefined }}>
        {l.score}
      </span>
    ),
  },
  { key: "value", header: "Est. value", align: "right", render: (l) => formatINR(l.value) },
  { key: "next", header: "Next action", render: (l) => l.nextAction, secondary: true },
  { key: "age", header: "Captured", align: "right", secondary: true, render: (l) => relativeTime(l.createdAt) },
];

export default async function LeadMasterPage({ searchParams }: { searchParams: Promise<{ q?: string; new?: string; import?: string }> }) {
  const [{ data }, q, params, staff] = await Promise.all([
    readMany(["leads", "dealers"] as const),
    readQuery(searchParams),
    searchParams,
    assignableStaff("leads.manage"),
  ]);
  const rows = data.leads;
  const dealerNames = data.dealers.filter((d) => d.status === "Active").map((d) => d.name);
  const leads = filterRows(rows, q);

  const converted = rows.filter((l) => l.status === "Converted").length;
  const pipelineValue = rows.filter((l) => !["Converted", "Lost"].includes(l.status)).reduce((s, l) => s + l.value, 0);

  return (
    <ModuleScreen
      href="/crm/leads"
      searchPlaceholder="Search leads"
      exportCollection="leads"
      stats={[
        { label: "Total leads", value: String(rows.length), hint: `${leads.length} shown` },
        { label: "Unassigned", value: String(rows.filter((l) => !l.assignedTo).length), hint: "Awaiting routing" },
        { label: "Converted", value: String(converted), hint: `${Math.round((converted / Math.max(1, rows.length)) * 100)}% of all leads` },
        { label: "Open pipeline value", value: formatINR(pipelineValue), hint: "Excludes converted and lost" },
      ]}
      toolbar={
        <>
        <Disclosure label="Add lead" open={params.new === "1"}>
          <ActionForm action={createLead} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="field-label">Name</label>
              <input name="name" required className="field" placeholder="Customer name" />
            </div>
            <div>
              <label className="field-label">Phone</label>
              <input name="phone" required type="tel" className="field" placeholder="98765 43210" />
            </div>
            <div>
              <label className="field-label">Email (optional)</label>
              <input name="email" type="email" maxLength={120} className="field" />
            </div>
            <div>
              <label className="field-label">City</label>
              <input name="city" className="field" placeholder="City" />
            </div>
            <div>
              <label className="field-label">State (optional)</label>
              <select name="state" className="field" defaultValue="">
                <option value="">Not given</option>
                {INDIAN_STATES.map((st) => (
                  <option key={st}>{st}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Pincode (optional)</label>
              <input name="pincode" inputMode="numeric" maxLength={6} className="field" />
            </div>
            <div>
              <label className="field-label">Model interest</label>
              <select name="model" className="field" defaultValue={VEHICLE_MODELS[0]}>
                {VEHICLE_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Source</label>
              <select name="source" className="field" defaultValue="Landing Page">
                {["Landing Page", "WhatsApp", "Walk-in", "Referral", "Dealer", "Call Centre", "Expo"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Assign to (optional)</label>
              <select name="assignedTo" className="field" defaultValue="">
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Dealer (optional)</label>
              <select name="dealer" className="field" defaultValue="">
                <option value="">None</option>
                {dealerNames.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Est. value (₹)</label>
              <input name="value" type="number" min={0} step={1} defaultValue={125000} className="field" />
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
              <SubmitButton>Add lead</SubmitButton>
              <Hint>The score is worked out, not typed: how complete the profile is (70%) and whether the phone and email are valid (30%), as EV-CRM scores it. Duplicates by phone or email are refused.</Hint>
            </div>
          </ActionForm>
        </Disclosure>
        <Disclosure label="Import leads (CSV)" open={params.import === "1"}>
          <ActionForm action={importLeads} resetOnSuccess className="space-y-3">
            <input name="file" type="file" accept=".csv,text/csv" required className="field" aria-label="CSV file" />
            <label className="flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" name="route" defaultChecked className="h-4 w-4" /> Route each lead to its nearest dealer
            </label>
            <SubmitButton size="sm">Import</SubmitButton>
            <Hint>
              Header row: name (or first name, last name), phone, email, city, state, pincode, model, source. Up to 1,000 rows. Each row needs a name and a phone or
              email; duplicates and bad rows are skipped with the reason.{" "}
              <a href="/templates/leads-import.csv" download className="underline">
                Download a template
              </a>
              .
            </Hint>
          </ActionForm>
        </Disclosure>
        </>
      }
    >
      <DataTable rows={leads} columns={LEAD_COLUMNS} empty="No leads match that search." />
    </ModuleScreen>
  );
}
