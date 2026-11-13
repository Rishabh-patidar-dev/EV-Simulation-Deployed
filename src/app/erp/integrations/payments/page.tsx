import Link from "next/link";
import { integrationTabs } from "@/components/erp/tabs";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { StatusPill, formatINR, relativeTime } from "@/components/ui/primitives";
import { FilterChips, SimulatedNote, Tabs, withParams } from "@/components/ui/workflow";
import { recordHref } from "@/lib/links";
import { filterRows } from "@/lib/search";
import { isToday } from "@/lib/time";
import { capturePayment, createInvoicePaymentLink, failPayment, refundPayment } from "@/server/actions/integrations";
import { readMany } from "@/server/store";
import type { Payment } from "@/server/types";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATUSES = ["Created", "Captured", "Failed", "Refunded"] as const;

const COLUMNS: Column<Payment>[] = [
  {
    key: "ref",
    header: "Payment",
    render: (p) => (
      <span className="block">
        <span className="num block font-medium">{p.gatewayRef}</span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {p.purpose} · {p.payer}
        </span>
      </span>
    ),
  },
  {
    key: "for",
    header: "For",
    secondary: true,
    render: (p) => {
      const href = recordHref(p.related);
      return href && p.related ? (
        <Link href={href} className="text-[12px] underline">
          {p.related.label}
        </Link>
      ) : (
        "—"
      );
    },
  },
  { key: "amount", header: "Amount", align: "right", render: (p) => <span className="whitespace-nowrap">{formatINR(p.amount)}</span> },
  { key: "method", header: "Method", secondary: true, render: (p) => (p.status === "Created" ? "—" : p.method) },
  { key: "fee", header: "Fee", align: "right", secondary: true, render: (p) => (p.fee ? formatINR(p.fee) : "—") },
  { key: "status", header: "Status", render: (p) => <StatusPill value={p.status} /> },
  { key: "at", header: "Created", align: "right", render: (p) => <span className="whitespace-nowrap">{relativeTime(p.createdAt)}</span> },
  {
    key: "act",
    header: "",
    align: "right",
    render: (p) =>
      p.status === "Created" ? (
        <details className="relative">
          <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: "var(--brand-ink)" }}>
            Webhook…
          </summary>
          <div className="surface absolute right-0 z-10 mt-1 w-60 space-y-2 rounded-[10px] p-3 text-left">
            <ActionForm action={capturePayment.bind(null, p.id)} className="space-y-2">
              <select name="method" className="field" defaultValue="UPI" aria-label="Paid by">
                <option>UPI</option>
                <option>Card</option>
                <option>Net Banking</option>
              </select>
              <SubmitButton size="sm">payment.captured</SubmitButton>
            </ActionForm>
            <ActionForm action={failPayment.bind(null, p.id)}>
              <SubmitButton size="sm" tone="danger">
                payment.failed
              </SubmitButton>
            </ActionForm>
          </div>
        </details>
      ) : p.status === "Captured" ? (
        <ActionForm action={refundPayment.bind(null, p.id)}>
          <SubmitButton size="sm" tone="ghost">
            Refund
          </SubmitButton>
        </ActionForm>
      ) : null,
  },
];

/** The payment gateway: booking-token links and dealer collections, as the gateway reports them. */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const statusParam = one(raw.status);
  const status = (STATUSES as readonly string[]).includes(statusParam) ? (statusParam as Payment["status"]) : undefined;

  const { data } = await readMany(["payments", "invoices", "connectors", "messages", "message_templates", "telematics"] as const);
  const rows = [...data.payments].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const shown = filterRows(rows, q).filter((p) => !status || p.status === status);
  const captured = rows.filter((p) => p.status === "Captured");
  const unpaid = data.invoices.filter((i) => i.amount > i.received && !rows.some((p) => p.related?.id === i.id && p.status === "Created"));

  return (
    <ModuleScreen
      href="/erp/integrations"
      exportCollection="payments"
      searchPlaceholder="Search payments, payers or references"
      tabs={
        <Tabs
          current="/erp/integrations/payments"
          tabs={integrationTabs({ connectors: data.connectors.length, messages: data.messages.length, templates: data.message_templates.length, payments: rows.length, devices: data.telematics.length })}
        />
      }
      stats={[
        { label: "Captured today", value: formatINR(captured.filter((p) => p.capturedAt && isToday(p.capturedAt)).reduce((s, p) => s + p.amount, 0)), hint: `${captured.length} captured in all` },
        { label: "Links open", value: String(rows.filter((p) => p.status === "Created").length), hint: formatINR(rows.filter((p) => p.status === "Created").reduce((s, p) => s + p.amount, 0)) },
        { label: "Gateway fees", value: formatINR(captured.reduce((s, p) => s + p.fee, 0)), hint: "UPI free · cards and net banking 2%" },
        { label: "Failed", value: String(rows.filter((p) => p.status === "Failed").length), hint: "Customer can pay from a new link" },
      ]}
      toolbar={
        <Disclosure label="Payment link for a dealer invoice">
          <ActionForm action={createInvoicePaymentLink} resetOnSuccess className="flex flex-wrap items-end gap-2">
            <div className="min-w-[18rem] flex-1">
              <label className="field-label" htmlFor="pl-invoice">
                Invoice
              </label>
              <select id="pl-invoice" name="invoiceId" required className="field" defaultValue="">
                <option value="" disabled>
                  Choose an unpaid invoice
                </option>
                {unpaid.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoiceNo} · {i.dealer} · {formatINR(i.amount - i.received)} due
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="pl-amount">
                Amount (blank = all due)
              </label>
              <input id="pl-amount" name="amount" type="number" min={1} className="field w-40!" />
            </div>
            <SubmitButton>Create link</SubmitButton>
          </ActionForm>
        </Disclosure>
      }
    >
      <FilterChips
        total={rows.length}
        current={status}
        hrefFor={(value) => withParams("/erp/integrations/payments", { q, status: value })}
        options={STATUSES.map((s) => ({ value: s, count: rows.filter((p) => p.status === s).length }))}
      />
      <DataTable rows={shown} columns={COLUMNS} empty={q || status ? "No payment matches those filters." : "No payments yet — converting a quotation sends a token link."} />
      <div className="p-4">
        <SimulatedNote>No money moves. The webhook buttons stand in for the gateway calling back; a captured dealer payment is applied to its invoice and posted as a receipt.</SimulatedNote>
      </div>
    </ModuleScreen>
  );
}
