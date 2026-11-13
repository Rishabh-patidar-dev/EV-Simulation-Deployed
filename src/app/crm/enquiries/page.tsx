import Link from "next/link";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { StatusPill, formatINR, relativeTime } from "@/components/ui/primitives";
import { filterRows, readQuery } from "@/lib/search";
import { VEHICLE_MODELS } from "@/lib/vehicles";
import { convertEnquiryToLead, createEnquiry, deleteEnquiry, updateEnquiry, updateEnquiryStatus } from "@/server/actions/crm";
import { readMany } from "@/server/store";
import type { Enquiry } from "@/server/types";

export const dynamic = "force-dynamic";

const NEXT_STATUS: Record<Enquiry["status"], Enquiry["status"] | null> = {
  Open: "Responded",
  Responded: "Quoted",
  Quoted: "Closed",
  Closed: null,
};

const CHANNELS: Enquiry["channel"][] = ["Landing Page", "WhatsApp", "Phone", "Walk-in"];

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<{ q?: string; new?: string }> }) {
  const [{ data }, q, params] = await Promise.all([readMany(["enquiries", "dealers"] as const), readQuery(searchParams), searchParams]);
  const rows = data.enquiries;
  const dealerNames = data.dealers.map((d) => d.name).sort((a, b) => a.localeCompare(b));
  const shown = filterRows(rows, q);

  const open = rows.filter((e) => e.status === "Open");
  const quoted = rows.filter((e) => e.status === "Quoted");

  const columns: Column<Enquiry>[] = [
    { key: "ref", header: "Reference", render: (e) => <span className="font-medium">{e.reference}</span> },
    { key: "customer", header: "Customer", render: (e) => e.customer },
    { key: "model", header: "Model", render: (e) => e.model, secondary: true },
    { key: "channel", header: "Channel", render: (e) => e.channel, secondary: true },
    { key: "dealer", header: "Routed to", render: (e) => e.dealer, secondary: true },
    { key: "value", header: "Est. value", align: "right", render: (e) => formatINR(e.value), secondary: true },
    { key: "status", header: "Status", render: (e) => <StatusPill value={e.status} /> },
    { key: "age", header: "Raised", align: "right", secondary: true, render: (e) => relativeTime(e.createdAt) },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (e) => {
        if (e.leadId) {
          return (
            <Link href={`/crm/leads/${e.leadId}`} className="text-[11.5px] hover:underline" style={{ color: "var(--brand-ink)" }}>
              View lead
            </Link>
          );
        }
        const next = NEXT_STATUS[e.status];
        return (
          <div className="flex items-center justify-end gap-1.5">
            {next && (
              <ActionForm action={updateEnquiryStatus.bind(null, e.id)}>
                <input type="hidden" name="status" value={next} />
                <SubmitButton size="sm" tone="ghost">{next === "Responded" ? "Mark responded" : next === "Quoted" ? "Mark quoted" : "Close"}</SubmitButton>
              </ActionForm>
            )}
            <ActionForm action={convertEnquiryToLead.bind(null, e.id)}>
              <SubmitButton size="sm">To lead</SubmitButton>
            </ActionForm>
            {/* Correcting what was taken down on the call, and removing a duplicate. */}
            <details className="relative">
              <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                Edit…
              </summary>
              <div className="surface absolute right-0 z-10 mt-1 w-72 space-y-3 rounded-[10px] p-3 text-left">
                <ActionForm action={updateEnquiry.bind(null, e.id)} className="space-y-2">
                  <p className="field-label">Enquiry details</p>
                  <input name="customer" defaultValue={e.customer} required maxLength={200} className="field" aria-label="Customer" />
                  <input name="phone" type="tel" defaultValue={e.phone} required className="field" aria-label="Phone" />
                  <select name="model" defaultValue={e.model} className="field" aria-label="Model">
                    {VEHICLE_MODELS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <input name="value" type="number" min={0} step={1} defaultValue={e.value} className="field" aria-label="Estimated value" />
                  <SubmitButton size="sm">Save enquiry</SubmitButton>
                </ActionForm>
                <details className="pt-1" style={{ borderTop: "1px solid var(--border)" }}>
                  <summary className="cursor-pointer pt-2 text-[12px] font-semibold" style={{ color: "var(--negative)" }}>
                    Delete this enquiry…
                  </summary>
                  <ActionForm action={deleteEnquiry.bind(null, e.id)} className="space-y-2 pt-2">
                    <p className="text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                      For a wrong number or a duplicate. It goes for good.
                    </p>
                    <SubmitButton size="sm" tone="danger">
                      Yes, delete {e.reference}
                    </SubmitButton>
                  </ActionForm>
                </details>
              </div>
            </details>
          </div>
        );
      },
    },
  ];

  return (
    <ModuleScreen
      href="/crm/enquiries"
      exportCollection="enquiries"
      searchPlaceholder="Search enquiries"
      toolbar={
        <Disclosure label="Log enquiry" open={params.new === "1"}>
          <ActionForm action={createEnquiry} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="field-label">Customer</label>
              <input name="customer" required maxLength={200} className="field" placeholder="Who called" />
            </div>
            <div>
              <label className="field-label">Phone</label>
              <input name="phone" type="tel" required className="field" placeholder="+91 90000 00000" />
            </div>
            <div>
              <label className="field-label">Model asked for</label>
              <select name="model" className="field" defaultValue={VEHICLE_MODELS[0]}>
                {VEHICLE_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Came in through</label>
              <select name="channel" className="field" defaultValue="Phone">
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Route to dealer</label>
              <select name="dealer" className="field" defaultValue={dealerNames[0] ?? ""}>
                {dealerNames.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Est. value (₹)</label>
              <input name="value" type="number" min={0} step={1} defaultValue={125000} className="field" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <SubmitButton>Log enquiry</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      }
      stats={[
        { label: "Enquiries", value: String(rows.length), hint: `${shown.length} shown` },
        { label: "Awaiting first response", value: String(open.length), hint: "Nobody has replied yet" },
        { label: "Quoted", value: String(quoted.length), hint: "Price shared with the customer" },
        { label: "Enquiry value", value: formatINR(rows.reduce((s, e) => s + e.value, 0)), hint: "Across every open channel" },
      ]}
    >
      <DataTable rows={shown} columns={columns} empty="No enquiries match that search." />
    </ModuleScreen>
  );
}
