import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { StatusPill, formatDate } from "@/components/ui/primitives";
import { BLOCKING_DOCUMENTS, RENEWAL_WINDOW_DAYS, complianceStatus, dealerCompliance } from "@/lib/compliance";
import Link from "next/link";
import { Card, CardHeader, Pill } from "@/components/ui/primitives";
import { Hint } from "@/components/ui/workflow";
import { filterRows, readQuery } from "@/lib/search";
import { daysUntilIso } from "@/lib/time";
import { addCompliance, deleteCompliance, remindAllDue, renewCompliance, sendComplianceReminder } from "@/server/actions/network";
import { readMany } from "@/server/store";
import type { ComplianceRecord } from "@/server/types";

export const dynamic = "force-dynamic";


const DOC_TYPES: ComplianceRecord["docType"][] = ["Trade Licence", "GST Registration", "Dealer Agreement", "Fire NOC", "Shop Insurance"];

const COLUMNS: Column<ComplianceRecord>[] = [
  { key: "dealer", header: "Dealer", render: (c) => <span className="font-medium">{c.dealer}</span> },
  { key: "doc", header: "Document", render: (c) => c.docType },
  {
    key: "ref",
    header: "Reference",
    secondary: true,
    render: (c) => (
      <span className="block">
        <span className="block">{c.reference}</span>
        {(c.renewals?.length || c.reminders?.length) ? (
          <span className="block text-[11px]" style={{ color: "var(--fg-faint)" }}>
            {c.renewals?.length ? `${c.renewals.length} renewal${c.renewals.length === 1 ? "" : "s"}` : ""}
            {c.renewals?.length && c.reminders?.length ? " · " : ""}
            {c.reminders?.length ? `reminded ${formatDate(c.reminders[c.reminders.length - 1].at)}` : ""}
          </span>
        ) : null}
      </span>
    ),
  },
  { key: "status", header: "Status", render: (c) => <StatusPill value={complianceStatus(c.expiresOn)} /> },
  { key: "expires", header: "Expires", align: "right", render: (c) => formatDate(c.expiresOn) },
  {
    key: "in",
    header: "Window",
    align: "right",
    render: (c) => {
      const d = daysUntilIso(c.expiresOn);
      return (
        <span style={{ color: d < 0 ? "var(--negative)" : d <= RENEWAL_WINDOW_DAYS ? "var(--warning)" : "var(--fg-muted)" }}>
          {d < 0 ? `${Math.abs(d)}d overdue` : `${d}d left`}
        </span>
      );
    },
  },
  {
    key: "renew",
    header: "",
    align: "right",
    render: (c) => (
      <details className="relative">
        <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: "var(--brand-ink)" }}>
          {complianceStatus(c.expiresOn) === "Valid" ? "Edit…" : "Renew…"}
        </summary>
        <div className="surface absolute right-0 z-10 mt-1 w-64 space-y-3 rounded-[10px] p-3 text-left">
          {complianceStatus(c.expiresOn) !== "Valid" && (
            <ActionForm action={sendComplianceReminder.bind(null, c.id)}>
              <SubmitButton size="sm" tone="ghost">
                Send WhatsApp reminder
              </SubmitButton>
            </ActionForm>
          )}
          <ActionForm action={renewCompliance.bind(null, c.id)} className="space-y-2">
            <p className="field-label">New reference, issue date and expiry</p>
            <input name="reference" required minLength={3} maxLength={40} defaultValue={c.reference} className="field" aria-label="New reference" />
            <input name="issuedOn" type="date" className="field" aria-label="Issued on" />
            <input name="expiresOn" type="date" required className="field" aria-label="New expiry" />
            <input name="notes" maxLength={300} defaultValue={c.notes ?? ""} className="field" placeholder="Notes" aria-label="Notes" />
            <SubmitButton size="sm">Record renewal</SubmitButton>
          </ActionForm>
          {c.renewals?.length ? (
            <ul className="space-y-0.5 text-[11px]" style={{ color: "var(--fg-muted)" }}>
              {[...c.renewals].reverse().map((r, i) => (
                <li key={i}>
                  {r.reference} to {formatDate(r.expiresOn)} · replaced {formatDate(r.renewedAt)}
                </li>
              ))}
            </ul>
          ) : null}
          <details className="pt-2" style={{ borderTop: "1px solid var(--border)" }}>
            <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: "var(--negative)" }}>
              Remove this document…
            </summary>
            <ActionForm action={deleteCompliance.bind(null, c.id)} className="space-y-2 pt-2">
              <p className="text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                For a document filed by mistake. {c.dealer} stops being tracked for {c.docType}.
              </p>
              <SubmitButton size="sm" tone="danger">
                Yes, remove it
              </SubmitButton>
            </ActionForm>
          </details>
        </div>
      </details>
    ),
  },
];

export default async function CompliancePage({ searchParams }: { searchParams: Promise<{ q?: string; new?: string }> }) {
  const [{ data }, q, params] = await Promise.all([readMany(["compliance", "dealers"] as const), readQuery(searchParams), searchParams]);
  const rows = data.compliance;
  const dealerNames = data.dealers.map((d) => d.name).sort((a, b) => a.localeCompare(b));

  // Soonest expiry first — this screen is a renewal queue.
  const ordered = [...rows].sort((a, b) => +new Date(a.expiresOn) - +new Date(b.expiresOn));
  const shown = filterRows(ordered, q);

  const files = data.dealers
    .filter((d) => d.status !== "Suspended")
    .map((d) => ({ d, file: dealerCompliance(d.name, rows) }))
    .sort((a, b) => b.file.blocking.length - a.file.blocking.length || a.file.score - b.file.score);
  const onHold = files.filter((f) => f.file.blocking.length);
  const expired = rows.filter((c) => complianceStatus(c.expiresOn) === "Expired");
  const expiring = rows.filter((c) => complianceStatus(c.expiresOn) === "Expiring Soon");

  return (
    <ModuleScreen
      href="/dms/dealers/compliance"
      exportCollection="compliance"
      searchPlaceholder="Search compliance"
      toolbar={
        <Disclosure label="File a document" open={params.new === "1"}>
          <ActionForm action={addCompliance} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="field-label">Dealer</label>
              <select name="dealer" className="field" defaultValue={dealerNames[0] ?? ""}>
                {dealerNames.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Document</label>
              <select name="docType" className="field" defaultValue="Trade Licence">
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Reference</label>
              <input name="reference" required minLength={3} maxLength={40} className="field" placeholder="Document number" />
            </div>
            <div>
              <label className="field-label">Expires on</label>
              <input name="expiresOn" type="date" required className="field" />
            </div>
            <div>
              <label className="field-label">Issued on (optional)</label>
              <input name="issuedOn" type="date" className="field" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="field-label">Notes (optional)</label>
              <input name="notes" maxLength={300} className="field" placeholder="e.g. Issued by the municipal corporation" />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <SubmitButton>File document</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      }
      stats={[
        { label: "Documents tracked", value: String(rows.length), hint: `${shown.length} shown` },
        { label: "Expired", value: String(expired.length), hint: "Renew immediately", tone: expired.length ? "negative" : "neutral" },
        { label: `Expiring in ${RENEWAL_WINDOW_DAYS} days`, value: String(expiring.length), hint: "Renewal window open", tone: expiring.length ? "warning" : "neutral" },
        { label: "On compliance hold", value: String(onHold.length), hint: `Expired ${BLOCKING_DOCUMENTS.join(" or ").toLowerCase()} — no new orders`, tone: onHold.length ? "negative" : "neutral" },
      ]}
      actions={
        expired.length + expiring.length ? (
          <ActionForm action={remindAllDue}>
            <SubmitButton tone="ghost">Remind all due</SubmitButton>
          </ActionForm>
        ) : undefined
      }
      aside={
        <Card>
          <CardHeader title="Dealer files" subtitle={`How complete each dealer's file is — ${BLOCKING_DOCUMENTS.join(" and ")} lapses stop new orders (simulation policy)`} />
          <ul className="space-y-2 px-5 pb-5 pt-1">
            {files.slice(0, 10).map(({ d, file }) => (
              <li key={d.id} className="text-[12.5px]">
                <span className="flex items-baseline justify-between gap-2">
                  <Link href={`/dms/dealers/${d.id}`} className="truncate font-medium hover:underline">
                    {d.name}
                  </Link>
                  <span className="num font-semibold" style={{ color: file.score === 100 ? "var(--positive)" : file.score < 60 ? "var(--negative)" : "var(--warning)" }}>
                    {file.score}%
                  </span>
                </span>
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {file.blocking.length > 0 && <Pill tone="negative">On hold</Pill>}
                  {file.missing.map((m) => (
                    <Pill key={m} tone="neutral">
                      No {m}
                    </Pill>
                  ))}
                  {file.expiring.length > 0 && <Pill tone="warning">{file.expiring.length} expiring</Pill>}
                </span>
              </li>
            ))}
            {files.length === 0 && (
              <li className="py-3 text-center text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                No dealers yet.
              </li>
            )}
          </ul>
          <div className="px-5 pb-4">
            <Hint>A renewal keeps the reference and expiry it replaced. Reminders go to the dealer&apos;s login on WhatsApp (the compliance_renewal template is added pending).</Hint>
          </div>
        </Card>
      }
    >
      <DataTable rows={shown} columns={COLUMNS} empty="No compliance records match that search." maxHeight={620} />
    </ModuleScreen>
  );
}
