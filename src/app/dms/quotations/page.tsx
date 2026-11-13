import Link from "next/link";
import { quotationTabs } from "@/components/quotations/tabs";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, Pill, StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { FilterChips, Hint, Tabs, withParams } from "@/components/ui/workflow";
import { INDIAN_STATES } from "@/lib/gst";
import { DISCOUNT_LIMIT_PCT, EXTENDED_WARRANTY_PCT, QUOTE_VALID_DAYS, quoteStatus, quoteTotals, quoteUnits } from "@/lib/quotes";
import { filterRows } from "@/lib/search";
import { createQuotation } from "@/server/actions/quotations";
import { readMany } from "@/server/store";
import { QUOTE_STATUSES, type Quotation } from "@/server/types";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

type Row = Quotation & { effective: Quotation["status"]; payable: number; discountPct: number; units: number; vehicle: string };

const COLUMNS: Column<Row>[] = [
  {
    key: "no",
    header: "Quotation",
    render: (q) => (
      <Link href={`/dms/quotations/${q.id}`} className="block hover:underline">
        <span className="block font-medium" style={{ color: "var(--brand-ink)" }}>
          {q.quoteNo}
        </span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {q.customer}
          {q.customerGstin ? " · B2B" : ""}
        </span>
      </Link>
    ),
  },
  { key: "vehicle", header: "Vehicle", secondary: true, render: (q) => <span className="block max-w-[14rem] truncate">{q.units} × {q.vehicle}</span> },
  { key: "dealer", header: "Dealer", secondary: true, render: (q) => q.dealer },
  { key: "payable", header: "Payable", align: "right", render: (q) => <span className="whitespace-nowrap">{formatINR(q.payable)}</span> },
  {
    key: "discount",
    header: "Discount",
    align: "right",
    secondary: true,
    render: (q) => <span style={q.discountPct > DISCOUNT_LIMIT_PCT ? { color: "var(--warning)" } : undefined}>{q.discountPct}%</span>,
  },
  { key: "status", header: "Status", render: (q) => <StatusPill value={q.effective} /> },
  {
    key: "valid",
    header: "Valid until",
    align: "right",
    render: (q) => <span className="whitespace-nowrap">{formatDate(q.validUntil)}</span>,
  },
];

/**
 * Quotation & GST invoicing — the quotation register, and the builder.
 * Quoting a deal from the pipeline pre-fills the customer (`?deal=`).
 */
export default async function QuotationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const statusParam = one(raw.status);
  const status = (QUOTE_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as Quotation["status"]) : undefined;

  const { data } = await readMany(["quotations", "products", "dealers", "deals", "tax_invoices"] as const);
  const rows: Row[] = data.quotations.map((quote) => {
    const totals = quoteTotals(quote);
    return {
      ...quote,
      effective: quoteStatus(quote),
      payable: totals.payable,
      discountPct: totals.discountPct,
      units: quoteUnits(quote),
      vehicle: quote.lines.find((l) => l.kind === "Vehicle")?.description ?? "—",
    };
  });
  const shown = filterRows(rows, q).filter((r) => !status || r.effective === status);

  const open = rows.filter((r) => ["Draft", "Sent", "Pending Approval", "Accepted"].includes(r.effective));
  const decided = rows.filter((r) => ["Converted", "Rejected", "Expired"].includes(r.effective));
  const converted = rows.filter((r) => r.effective === "Converted");
  const pending = rows.filter((r) => r.effective === "Pending Approval");
  const avgDiscount = rows.length ? Math.round((rows.reduce((s, r) => s + r.discountPct, 0) / rows.length) * 10) / 10 : 0;

  const products = data.products.filter((p) => p.active).sort((a, b) => a.segment.localeCompare(b.segment) || a.model.localeCompare(b.model));
  const dealers = data.dealers.filter((d) => d.status !== "Suspended").sort((a, b) => a.name.localeCompare(b.name));
  const openDeals = data.deals.filter((d) => d.stage !== "Booked").sort((a, b) => a.customer.localeCompare(b.customer));
  const deal = data.deals.find((d) => d.id === one(raw.deal));
  const dealDealer = deal ? dealers.find((d) => d.name === deal.dealer) : undefined;

  return (
    <ModuleScreen
      href="/dms/quotations"
      exportCollection="quotations"
      searchPlaceholder="Search quotations, customers or dealers"
      tabs={<Tabs current="/dms/quotations" tabs={quotationTabs({ quotes: rows.length, invoices: data.tax_invoices.length, models: data.products.length })} />}
      stats={[
        { label: "Open quotations", value: String(open.length), hint: `${formatINR(open.reduce((s, r) => s + r.payable, 0))} if all convert` },
        { label: "Awaiting discount approval", value: String(pending.length), hint: `Over the ${DISCOUNT_LIMIT_PCT}% limit`, tone: pending.length ? "warning" : "neutral" },
        { label: "Conversion", value: decided.length ? `${Math.round((converted.length / decided.length) * 100)}%` : "—", hint: `${converted.length} of ${decided.length} decided became bookings` },
        { label: "Average discount", value: `${avgDiscount}%`, hint: "Across every quotation" },
      ]}
      toolbar={
        <Disclosure label={deal ? `New quotation for ${deal.customer}` : "New quotation"} open={one(raw.new) === "1" || Boolean(deal)}>
          <form method="get" action="/dms/quotations" className="mb-4 flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1">
              <label className="field-label" htmlFor="quote-deal">
                Quote a pipeline deal (optional)
              </label>
              <select id="quote-deal" name="deal" className="field" defaultValue={deal?.id ?? ""}>
                <option value="">— A new customer —</option>
                {openDeals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.customer} · {d.model} · {d.stage} · {d.dealer}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-ghost">
              Fill in from the deal
            </button>
          </form>

          <ActionForm action={createQuotation} className="space-y-4">
            {deal && <input type="hidden" name="dealId" value={deal.id} />}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="field-label" htmlFor="quote-customer">
                  Customer
                </label>
                <input id="quote-customer" name="customer" required maxLength={120} className="field" defaultValue={deal?.customer} placeholder="Name or business" />
              </div>
              <div>
                <label className="field-label" htmlFor="quote-phone">
                  Mobile
                </label>
                <input id="quote-phone" name="phone" required inputMode="tel" className="field" defaultValue={deal?.phone} placeholder="98765 43210" />
              </div>
              <div>
                <label className="field-label" htmlFor="quote-state">
                  Customer&apos;s state
                </label>
                <select id="quote-state" name="customerState" required className="field" defaultValue={dealDealer?.state ?? ""}>
                  <option value="" disabled>
                    Place of supply
                  </option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="quote-gstin">
                  GSTIN (business buyers)
                </label>
                <input id="quote-gstin" name="customerGstin" maxLength={15} className="field uppercase" placeholder="27ABCDE1234F1Z5" />
              </div>
              <div>
                <label className="field-label" htmlFor="quote-dealer">
                  Dealer
                </label>
                <select id="quote-dealer" name="dealer" required className="field" defaultValue={dealDealer?.name ?? ""}>
                  <option value="" disabled>
                    Choose a dealer
                  </option>
                  {dealers.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name} — {d.state}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="field-label" htmlFor="quote-vehicle">
                  Vehicle
                </label>
                <select id="quote-vehicle" name="vehicle" required className="field" defaultValue="">
                  <option value="" disabled>
                    Model and variant
                  </option>
                  {products.map((p) => (
                    <optgroup key={p.id} label={`${p.model} — ${p.segment} ${p.bodyType}`}>
                      {p.variants.map((v) => (
                        <option key={v.variant} value={`${p.model}::${v.variant}`}>
                          {p.model} {v.variant} — {formatINR(v.exShowroom)} ex-showroom
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="quote-qty">
                  Quantity
                </label>
                <input id="quote-qty" name="quantity" type="number" min={1} max={100} required defaultValue={1} className="field" />
              </div>
              <div>
                <label className="field-label" htmlFor="quote-discount">
                  Discount (₹, before GST)
                </label>
                <input id="quote-discount" name="discount" type="number" min={0} step={1} defaultValue={0} className="field" />
              </div>
              <div>
                <label className="field-label" htmlFor="quote-warranty">
                  Extended warranty
                </label>
                <select id="quote-warranty" name="extendedWarranty" className="field" defaultValue="">
                  <option value="">None</option>
                  {Object.entries(EXTENDED_WARRANTY_PCT).map(([years, pct]) => (
                    <option key={years} value={years}>
                      {years} year{years === "1" ? "" : "s"} — {pct}% of vehicle value
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-[12.5px]">
                <input type="checkbox" name="includeRegistration" defaultChecked /> Registration &amp; HSRP
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-[12.5px]">
                <input type="checkbox" name="includeInsurance" defaultChecked /> First-year insurance
              </label>
            </div>

            <fieldset className="space-y-2">
              <legend className="field-label">Accessories (optional, 18% GST)</legend>
              {[0, 1, 2].map((i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_5rem_8rem] gap-2">
                  <input name="accDesc" maxLength={80} className="field" placeholder={i === 0 ? "e.g. Rain cover" : "Description"} aria-label={`Accessory ${i + 1}`} />
                  <input name="accQty" type="number" min={1} max={500} defaultValue={1} className="field" aria-label={`Accessory ${i + 1} quantity`} />
                  <input name="accPrice" type="number" min={1} step={1} className="field" placeholder="₹ each" aria-label={`Accessory ${i + 1} price before GST`} />
                </div>
              ))}
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton>Draft quotation</SubmitButton>
              <Hint>
                Prices come from the price list. GST is split by place of supply; eligible e-rickshaws and e-carts carry the PM E-DRIVE incentive. Valid {QUOTE_VALID_DAYS} days; a
                discount over {DISCOUNT_LIMIT_PCT}% goes for approval when sent.
              </Hint>
            </div>
          </ActionForm>
        </Disclosure>
      }
      aside={
        <Card>
          <CardHeader title="Waiting on someone" subtitle="Discounts to approve and quotes with the customer" />
          <ul className="space-y-2.5 px-5 pb-5 pt-1">
            {rows
              .filter((r) => r.effective === "Pending Approval" || r.effective === "Sent")
              .sort((a, b) => +new Date(a.validUntil) - +new Date(b.validUntil))
              .slice(0, 7)
              .map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-3">
                  <Link href={`/dms/quotations/${r.id}`} className="min-w-0 hover:underline">
                    <span className="block truncate text-[12.5px] font-medium">{r.customer}</span>
                    <span className="block truncate text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                      {r.quoteNo} · {formatINR(r.payable)}
                    </span>
                  </Link>
                  <Pill tone={r.effective === "Pending Approval" ? "warning" : "info"}>{r.effective === "Pending Approval" ? "Approval" : "With customer"}</Pill>
                </li>
              ))}
            {!rows.some((r) => r.effective === "Pending Approval" || r.effective === "Sent") && (
              <li className="py-3 text-center text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                Nothing is waiting.
              </li>
            )}
          </ul>
        </Card>
      }
    >
      <FilterChips
        total={rows.length}
        current={status}
        hrefFor={(value) => withParams("/dms/quotations", { q, status: value })}
        options={QUOTE_STATUSES.map((s) => ({ value: s, count: rows.filter((r) => r.effective === s).length }))}
      />
      <DataTable rows={shown} columns={COLUMNS} empty={q || status ? "No quotation matches those filters." : "No quotations yet — draft the first one above."} />
    </ModuleScreen>
  );
}
