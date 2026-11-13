import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { Pill, StatusPill, relativeTime } from "@/components/ui/primitives";
import { filterRows, readQuery } from "@/lib/search";
import { completeFollowUp, createFollowUp, deleteFollowUp, rescheduleFollowUp, updateFollowUp } from "@/server/actions/crm";
import { OPERATOR } from "@/lib/operator";
import { assignableStaff } from "@/server/staff";
import { readCollection } from "@/server/store";
import type { FollowUp } from "@/server/types";

export const dynamic = "force-dynamic";

function rank(f: FollowUp) {
  return f.status === "Overdue" ? 0 : f.status === "Due" ? 1 : 2;
}

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ rows }, q, staff] = await Promise.all([readCollection("follow_ups"), readQuery(searchParams), assignableStaff("followups.manage")]);

  // Overdue first: this screen exists to clear a queue, not to browse history.
  const ordered = [...rows].sort((a, b) => rank(a) - rank(b) || +new Date(a.dueAt) - +new Date(b.dueAt));
  const shown = filterRows(ordered, q);

  const columns: Column<FollowUp>[] = [
    { key: "subject", header: "Follow-up", render: (f) => <span className="font-medium">{f.subject}</span> },
    { key: "customer", header: "Customer", render: (f) => f.customer },
    { key: "related", header: "Against", render: (f) => <Pill tone="neutral">{f.relatedTo}</Pill>, secondary: true },
    { key: "channel", header: "Channel", render: (f) => f.channel, secondary: true },
    { key: "owner", header: "Owner", render: (f) => f.owner, secondary: true },
    { key: "status", header: "Status", render: (f) => <StatusPill value={f.status} /> },
    {
      key: "due",
      header: "Due",
      align: "right",
      render: (f) => (
        <span style={f.status === "Overdue" ? { color: "var(--negative)" } : undefined}>{relativeTime(f.dueAt)}</span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (f) =>
        f.status === "Done" ? (
          <span style={{ color: "var(--fg-faint)" }}>—</span>
        ) : (
          <div className="flex items-center gap-1.5">
            <ActionForm action={completeFollowUp.bind(null, f.id)}>
              <SubmitButton size="sm">Done</SubmitButton>
            </ActionForm>
            <ActionForm action={rescheduleFollowUp.bind(null, f.id)} className="flex items-center gap-1">
              <input type="date" name="dueAt" required className="field !w-auto py-1.5 text-[12px]" />
              <SubmitButton size="sm" tone="ghost">Reschedule</SubmitButton>
            </ActionForm>
            <ActionForm action={deleteFollowUp.bind(null, f.id)}>
              <SubmitButton size="sm" tone="danger">Cancel</SubmitButton>
            </ActionForm>
            <details className="relative">
              <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                Edit…
              </summary>
              <div className="surface absolute right-0 z-10 mt-1 w-72 rounded-[10px] p-3 text-left">
                <ActionForm action={updateFollowUp.bind(null, f.id)} className="space-y-2">
                  <p className="field-label">Follow-up details</p>
                  <input name="subject" defaultValue={f.subject} required maxLength={200} className="field" aria-label="Subject" />
                  <input name="customer" defaultValue={f.customer} required maxLength={200} className="field" aria-label="Customer" />
                  <select name="owner" defaultValue={staff.includes(f.owner) ? f.owner : ""} className="field" aria-label="Owner">
                    <option value="" disabled>Owner…</option>
                    {staff.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                  <select name="channel" defaultValue={f.channel} className="field" aria-label="Channel">
                    {(["Call", "WhatsApp", "Visit", "Email"] satisfies FollowUp["channel"][]).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <SubmitButton size="sm">Save follow-up</SubmitButton>
                </ActionForm>
              </div>
            </details>
          </div>
        ),
    },
  ];

  return (
    <ModuleScreen
      href="/crm/follow-ups"
      exportCollection="follow_ups"
      searchPlaceholder="Search follow-ups"
      stats={[
        { label: "Scheduled", value: String(rows.length), hint: `${shown.length} shown` },
        { label: "Overdue", value: String(rows.filter((f) => f.status === "Overdue").length), hint: "Past the promised date" },
        { label: "Due", value: String(rows.filter((f) => f.status === "Due").length), hint: "Still inside the window" },
        { label: "Completed", value: String(rows.filter((f) => f.status === "Done").length), hint: "Closed by the owner" },
      ]}
      toolbar={
        <Disclosure label="Schedule follow-up">
          <ActionForm action={createFollowUp} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="field-label">Subject</label>
              <input name="subject" required className="field" placeholder="e.g. Confirm finance documents" />
            </div>
            <div>
              <label className="field-label">Customer</label>
              <input name="customer" required className="field" placeholder="Customer name" />
            </div>
            <div>
              <label className="field-label">Owner</label>
              <select name="owner" className="field" defaultValue={staff.includes(OPERATOR.name) ? OPERATOR.name : staff[0]}>
                {staff.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Channel</label>
              <select name="channel" className="field" defaultValue="Call">
                {["Call", "WhatsApp", "Visit", "Email"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Due date</label>
              <input name="dueAt" type="date" required className="field" />
            </div>
            <div className="sm:col-span-2 lg:col-span-5">
              <SubmitButton>Schedule</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      }
    >
      <DataTable rows={shown} columns={columns} empty="No follow-ups match that search." />
    </ModuleScreen>
  );
}
