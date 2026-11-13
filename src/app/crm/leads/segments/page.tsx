import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { Pill, formatDate } from "@/components/ui/primitives";
import { describeSegmentFilter, segmentLeads } from "@/lib/segments";
import { filterRows, readQuery } from "@/lib/search";
import { createSegment, deleteSegment, updateSegment } from "@/server/actions/crm";
import { readMany } from "@/server/store";
import type { Lead, Segment } from "@/server/types";

export const dynamic = "force-dynamic";

interface SegmentRow extends Segment {
  size: number;
}

const COLUMNS: Column<SegmentRow>[] = [
  { key: "name", header: "Segment", render: (s) => <span className="font-medium">{s.name}</span> },
  {
    key: "filter",
    header: "Filter",
    secondary: true,
    render: (s) => (
      <code className="rounded px-1.5 py-0.5 text-[11.5px]" style={{ background: "var(--bg)", color: "var(--fg-muted)" }}>
        {describeSegmentFilter(s.filter)}
      </code>
    ),
  },
  { key: "channel", header: "Channel", render: (s) => <Pill tone="brand">{s.channel}</Pill> },
  { key: "size", header: "Contacts", align: "right", render: (s) => s.size.toLocaleString("en-IN") },
  { key: "createdBy", header: "Created by", secondary: true, render: (s) => s.createdBy },
  { key: "updated", header: "Refreshed", align: "right", secondary: true, render: (s) => formatDate(s.updatedAt) },
  {
    key: "actions",
    header: "",
    align: "right",
    render: (s) => (
      <details className="relative">
        <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: "var(--brand-ink)" }}>
          Edit…
        </summary>
        <div className="surface absolute right-0 z-10 mt-1 w-72 space-y-3 rounded-[10px] p-3 text-left">
          <ActionForm action={updateSegment.bind(null, s.id)} className="space-y-2">
            <p className="field-label">Name and filter</p>
            <input name="name" defaultValue={s.name} required maxLength={200} className="field" aria-label="Segment name" />
            <select name="source" defaultValue={s.filter.source ?? ""} className="field" aria-label="Source">
              <option value="">Any source</option>
              {(["Landing Page", "WhatsApp", "Walk-in", "Referral", "Dealer", "Call Centre", "Expo", "Import"] satisfies Lead["source"][]).map((src) => (
                <option key={src} value={src}>{src}</option>
              ))}
            </select>
            <select name="status" defaultValue={s.filter.status ?? ""} className="field" aria-label="Status">
              <option value="">Any status</option>
              {(["New", "Contacted", "Qualified", "Test Drive", "Converted", "Lost"] satisfies Lead["status"][]).map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <input name="city" defaultValue={s.filter.city ?? ""} maxLength={200} className="field" placeholder="Any city" aria-label="City" />
              <input name="minScore" type="number" min={0} max={100} defaultValue={s.filter.minScore ?? ""} className="field w-24!" placeholder="Score" aria-label="Minimum score" />
            </div>
            <select name="channel" defaultValue={s.channel} className="field" aria-label="Channel">
              {["Email", "WhatsApp", "SMS", "Mixed"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <SubmitButton size="sm">Save segment</SubmitButton>
          </ActionForm>
          <div className="pt-2" style={{ borderTop: "1px solid var(--border)" }}>
            <ActionForm action={deleteSegment.bind(null, s.id)}>
              <SubmitButton size="sm" tone="danger">Delete segment</SubmitButton>
            </ActionForm>
          </div>
        </div>
      </details>
    ),
  },
];

export default async function SegmentsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ data }, q] = await Promise.all([readMany(["segments", "leads"] as const), readQuery(searchParams)]);

  // The size shown for every segment is computed here, against the leads
  // collection as it stands right now — never a stored count.
  const withSize: SegmentRow[] = data.segments.map((s) => ({ ...s, size: segmentLeads(data.leads, s.filter).length }));
  const shown = filterRows(withSize, q);
  const reach = withSize.reduce((s, r) => s + r.size, 0);

  return (
    <ModuleScreen
      href="/crm/leads/segments"
      exportCollection="segments"
      searchPlaceholder="Search segments"
      stats={[
        { label: "Segments", value: String(withSize.length), hint: `${shown.length} shown` },
        { label: "Total reach", value: reach.toLocaleString("en-IN"), hint: "Live count across all segments" },
        { label: "WhatsApp-targeted", value: String(withSize.filter((r) => r.channel === "WhatsApp").length), hint: "Highest response channel" },
        {
          label: "Largest segment",
          value: withSize.length ? Math.max(...withSize.map((r) => r.size)).toLocaleString("en-IN") : "0",
          hint: "Contacts in the biggest set",
        },
      ]}
      toolbar={
        <Disclosure label="Create segment">
          <ActionForm action={createSegment} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="field-label">Name</label>
              <input name="name" required className="field" placeholder="Segment name" />
            </div>
            <div>
              <label className="field-label">Source</label>
              <select name="source" className="field" defaultValue="">
                <option value="">Any</option>
                {(["Landing Page", "WhatsApp", "Walk-in", "Referral", "Dealer", "Call Centre", "Expo", "Import"] satisfies Lead["source"][]).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Status</label>
              <select name="status" className="field" defaultValue="">
                <option value="">Any</option>
                {(["New", "Contacted", "Qualified", "Test Drive", "Converted", "Lost"] satisfies Lead["status"][]).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Min. score</label>
              <input name="minScore" type="number" min={0} max={100} className="field" placeholder="e.g. 70" />
            </div>
            <div>
              <label className="field-label">Channel</label>
              <select name="channel" className="field" defaultValue="Email">
                {["Email", "WhatsApp", "SMS", "Mixed"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2 lg:col-span-5">
              <SubmitButton>Create segment</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      }
    >
      <DataTable rows={shown} columns={COLUMNS} empty="No segments match that search." />
    </ModuleScreen>
  );
}
