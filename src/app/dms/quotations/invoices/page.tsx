import Link from "next/link";
import { quotationTabs } from "@/components/quotations/tabs";
import ModuleScreen from "@/components/shell/ModuleScreen";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { Pill, StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { FilterChips, Tabs, withParams } from "@/components/ui/workflow";
import { filterRows } from "@/lib/search";
import { isThisMonth } from "@/lib/time";
import { readMany } from "@/server/store";
import type { TaxInvoice } from "@/server/types";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const COLUMNS: Column<TaxInvoice>[] = [
  {
    key: "no",
    header: "Invoice",
    render: (i) => (
      <Link href={`/dms/quotations/invoices/${i.id}`} className="block hover:underline">
        <span className="block font-medium" style={{ color: "var(--brand-ink)" }}>
          {i.invoiceNo}
        </span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {i.customer}
        </span>
      </Link>
    ),
  },
  { key: "kind", header: "Kind", secondary: true, render: (i) => i.kind },
  { key: "dealer", header: "Dealer", secondary: true, render: (i) => i.dealer },
  {
    key: "supply",
    header: "Supply",
    secondary: true,
    render: (i) => (
      <span className="flex flex-wrap gap-1">
        {i.customerGstin ? <Pill tone="brand">B2B</Pill> : <Pill tone="neutral">B2C</Pill>}
        <Pill tone="neutral">{i.igst ? "IGST" : "CGST+SGST"}</Pill>
      </span>
    ),
  },
  { key: "taxable", header: "Taxable", align: "right", secondary: true, render: (i) => <span className="whitespace-nowrap">{formatINR(i.taxable)}</span> },
  { key: "gst", header: "GST", align: "right", render: (i) => <span className="whitespace-nowrap">{formatINR(i.cgst + i.sgst + i.igst)}</span> },
  { key: "total", header: "Total", align: "right", render: (i) => <span className="whitespace-nowrap font-medium">{formatINR(i.total)}</span> },
  { key: "status", header: "Status", render: (i) => <StatusPill value={i.status} /> },
  { key: "date", header: "Issued", align: "right", render: (i) => <span className="whitespace-nowrap">{formatDate(i.issuedAt)}</span> },
];

/** Every dealer → customer GST invoice: vehicle sales issued at delivery, and workshop bills. */
export default async function TaxInvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const kind = one(raw.kind) || undefined;

  const { data } = await readMany(["tax_invoices", "quotations", "products"] as const);
  const rows = data.tax_invoices;
  const issued = rows.filter((i) => i.status === "Issued");
  const shown = filterRows(rows, q).filter((i) => !kind || i.kind === kind);
  const thisMonth = issued.filter((i) => isThisMonth(i.issuedAt));

  return (
    <ModuleScreen
      href="/dms/quotations"
      exportCollection="tax_invoices"
      searchPlaceholder="Search invoices or customers"
      tabs={<Tabs current="/dms/quotations/invoices" tabs={quotationTabs({ quotes: data.quotations.length, invoices: rows.length, models: data.products.length })} />}
      stats={[
        { label: "Invoiced this month", value: formatINR(thisMonth.reduce((s, i) => s + i.total, 0)), hint: `${thisMonth.length} invoices` },
        { label: "Output GST", value: formatINR(issued.reduce((s, i) => s + i.cgst + i.sgst + i.igst, 0)), hint: "On every issued invoice" },
        { label: "e-Invoices (B2B)", value: String(issued.filter((i) => i.irn).length), hint: "Carrying an IRN" },
        { label: "PM E-DRIVE passed on", value: formatINR(issued.reduce((s, i) => s + i.subsidy, 0)), hint: "Deducted from what buyers paid" },
      ]}
    >
      <FilterChips
        total={rows.length}
        current={kind}
        hrefFor={(value) => withParams("/dms/quotations/invoices", { q, kind: value })}
        options={(["Vehicle Sale", "Service"] as const).map((k) => ({ value: k, count: rows.filter((i) => i.kind === k).length }))}
      />
      <DataTable rows={shown} columns={COLUMNS} empty={q || kind ? "No invoice matches those filters." : "No tax invoices yet — they are issued when a vehicle is handed over or a job card is closed."} />
    </ModuleScreen>
  );
}
