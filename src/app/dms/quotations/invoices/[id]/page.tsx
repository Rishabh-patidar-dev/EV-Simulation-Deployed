import Link from "next/link";
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import DetailScreen from "@/components/shell/DetailScreen";
import ActionForm from "@/components/ui/ActionForm";
import PrintButton from "@/components/ui/PrintButton";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill } from "@/components/ui/primitives";
import { fullDate } from "@/components/ui/workflow";
import { amountInWords, computeTax, rupees } from "@/lib/gst";
import { hoursSince } from "@/lib/time";
import { cancelTaxInvoice, generateIrn } from "@/server/actions/quotations";
import { readMany } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * A GST tax invoice laid out the way the rules require it printed: supplier
 * and recipient with GSTINs, place of supply, HSN/SAC per line, the tax split,
 * a rate-wise summary, the amount in words, and — for B2B — the IRN.
 */
export default async function TaxInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await readMany(["tax_invoices", "dealers", "quotations", "bookings", "job_cards"] as const);
  const inv = data.tax_invoices.find((i) => i.id === id);
  if (!inv) notFound();

  const dealer = data.dealers.find((d) => d.name === inv.dealer);
  const tax = computeTax(inv.lines, inv.discount, inv.dealerState, inv.placeOfSupply);
  const quote = inv.quotationId ? data.quotations.find((q) => q.id === inv.quotationId) : undefined;
  const booking = inv.bookingId ? data.bookings.find((b) => b.id === inv.bookingId) : undefined;
  const job = inv.jobCardId ? data.job_cards.find((j) => j.id === inv.jobCardId) : undefined;
  const cancellable = inv.status === "Issued" && (!inv.irn || hoursSince(inv.ackAt ?? inv.issuedAt) < 24);

  return (
    <DetailScreen
      moduleHref="/dms/quotations"
      title={inv.invoiceNo}
      badges={
        <>
          <StatusPill value={inv.status} />
          <Pill tone={inv.customerGstin ? "brand" : "neutral"}>{inv.customerGstin ? "B2B e-invoice" : "B2C"}</Pill>
          {inv.customerGstin && !inv.irn && <Pill tone="warning">IRN pending</Pill>}
        </>
      }
      subtitle={`${inv.kind} · ${inv.customer} · issued ${fullDate(inv.issuedAt)}`}
      actions={
        <>
          <PrintButton label="Print invoice" />
          {inv.customerGstin && !inv.irn && inv.status === "Issued" && (
            <ActionForm action={generateIrn.bind(null, inv.id)}>
              <SubmitButton size="sm">Generate IRN</SubmitButton>
            </ActionForm>
          )}
        </>
      }
    >
      <article className="surface mx-auto w-full max-w-[900px] p-6 text-[12.5px] print:max-w-none print:border-0 print:p-0 print:shadow-none" aria-label="Tax invoice">
        <header className="flex flex-wrap items-start justify-between gap-4 pb-4" style={{ borderBottom: "2px solid var(--fg)" }}>
          <div>
            <p className="text-[18px] font-bold">{inv.dealer}</p>
            <p style={{ color: "var(--fg-muted)" }}>
              {dealer ? `${dealer.city}, ${dealer.state}` : inv.dealerState} · Authorised dealer, Luxus Green Mobility
            </p>
            <p className="num mt-1">GSTIN {inv.dealerGstin}</p>
          </div>
          <div className="text-right">
            <p className="text-[16px] font-bold tracking-wide">TAX INVOICE</p>
            <p className="num">{inv.invoiceNo}</p>
            <p>{fullDate(inv.issuedAt)}</p>
            {inv.status === "Cancelled" && <p className="mt-1 font-bold" style={{ color: "var(--negative)" }}>CANCELLED — {inv.cancelReason}</p>}
          </div>
        </header>

        <section className="grid gap-4 py-4 sm:grid-cols-2" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <p className="field-label">Billed to</p>
            <p className="font-semibold">{inv.customer}</p>
            <p className="num">{inv.customerGstin ? `GSTIN ${inv.customerGstin}` : "Unregistered buyer"}</p>
          </div>
          <div className="sm:text-right">
            <p className="field-label">Place of supply</p>
            <p className="font-semibold">{inv.placeOfSupply}</p>
            <p>{tax.interState ? "Inter-state supply — IGST" : "Intra-state supply — CGST + SGST"}</p>
            {inv.vins.length > 0 && (
              <p className="num mt-1" style={{ overflowWrap: "anywhere" }}>
                Chassis: {inv.vins.join(", ")}
              </p>
            )}
          </div>
        </section>

        <div className="overflow-x-auto py-3">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Description</th>
                <th>HSN/SAC</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Rate</th>
                <th className="text-right">Taxable</th>
                {tax.interState ? <th className="text-right">IGST</th> : (
                  <>
                    <th className="text-right">CGST</th>
                    <th className="text-right">SGST</th>
                  </>
                )}
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {tax.lines.map((l, i) => (
                <tr key={i}>
                  <td className="num">{i + 1}</td>
                  <td>{l.description}</td>
                  <td className="num">{l.hsn}</td>
                  <td className="num text-right">{l.quantity}</td>
                  <td className="num text-right">{rupees(l.unitPrice)}</td>
                  <td className="num text-right">{rupees(l.taxable)}</td>
                  {tax.interState ? (
                    <td className="num text-right">{l.gstRate ? `${rupees(l.igst)} (${l.gstRate}%)` : "Nil"}</td>
                  ) : (
                    <>
                      <td className="num text-right">{l.gstRate ? `${rupees(l.cgst)} (${l.gstRate / 2}%)` : "Nil"}</td>
                      <td className="num text-right">{l.gstRate ? `${rupees(l.sgst)} (${l.gstRate / 2}%)` : "Nil"}</td>
                    </>
                  )}
                  <td className="num text-right font-semibold">{rupees(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="grid gap-4 pt-3 sm:grid-cols-[minmax(0,1fr)_18rem]" style={{ borderTop: "1px solid var(--border)" }}>
          <div>
            <p className="field-label">Tax summary</p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rate</th>
                  <th className="text-right">Taxable</th>
                  <th className="text-right">Tax</th>
                </tr>
              </thead>
              <tbody>
                {tax.byRate.map((r) => (
                  <tr key={r.rate}>
                    <td>{r.rate ? `${r.rate}%` : "Nil / non-taxable"}</td>
                    <td className="num text-right">{rupees(r.taxable)}</td>
                    <td className="num text-right">{rupees(r.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 font-medium">{amountInWords(inv.payable)}</p>
          </div>
          <dl className="space-y-1.5">
            {[
              inv.discount > 0 ? ["Discount", `−${rupees(inv.discount)}`] : null,
              ["Taxable value", rupees(inv.taxable)],
              ...(inv.igst ? [["IGST", rupees(inv.igst)]] : [["CGST", rupees(inv.cgst)], ["SGST", rupees(inv.sgst)]]),
              ["Invoice total", rupees(inv.total)],
              inv.subsidy > 0 ? ["Less PM E-DRIVE incentive", `−${rupees(inv.subsidy)}`] : null,
            ]
              .filter((r): r is string[] => Boolean(r))
              .map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt style={{ color: "var(--fg-muted)" }}>{label}</dt>
                  <dd className="num font-medium">{value}</dd>
                </div>
              ))}
            <div className="flex justify-between gap-3 pt-1.5 text-[15px] font-bold" style={{ borderTop: "1px solid var(--fg)" }}>
              <dt>Payable</dt>
              <dd className="num">{rupees(inv.payable)}</dd>
            </div>
          </dl>
        </section>

        {(inv.irn || inv.ewayBillNo) && (
          <section className="mt-4 space-y-1 pt-3 text-[11.5px]" style={{ borderTop: "1px dashed var(--border)" }}>
            {inv.irn && (
              <>
                <p className="num" style={{ overflowWrap: "anywhere" }}>
                  IRN {inv.irn}
                </p>
                <p className="num">
                  Ack No. {inv.ackNo} · Ack date {inv.ackAt ? fullDate(inv.ackAt) : "—"}
                </p>
              </>
            )}
            {inv.ewayBillNo && <p className="num">E-way bill {inv.ewayBillNo}</p>}
            <p style={{ color: "var(--fg-muted)" }}>Simulated — the IRN is computed the way the IRP computes it, but nothing was filed with the GST network.</p>
          </section>
        )}
      </article>

      <div className="mx-auto flex w-full max-w-[900px] flex-wrap items-start justify-between gap-3 print:hidden">
        <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
          {quote && (
            <>
              From quotation{" "}
              <Link href={`/dms/quotations/${quote.id}`} className="underline">
                {quote.quoteNo}
              </Link>
              {booking ? ` · booking ${booking.bookingNo}` : ""}
            </>
          )}
          {job && (
            <>
              From job card{" "}
              <Link href={`/dms/service/jobcards/${job.id}`} className="underline">
                {job.jobNo}
              </Link>
            </>
          )}
        </p>
        {cancellable && (
          <details className="disclosure surface w-full max-w-sm">
            <summary className="flex items-center gap-2 px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--negative)" }}>
              <TriangleAlert className="h-4 w-4" />
              Cancel this invoice…
            </summary>
            <ActionForm action={cancelTaxInvoice.bind(null, inv.id)} className="space-y-2.5 px-4 pb-4">
              <p className="text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                {inv.irn ? "An e-invoice can be cancelled only within 24 hours of its IRN." : "A credit note is posted to the books."}
              </p>
              <textarea name="reason" required minLength={3} maxLength={300} rows={2} className="field" placeholder="Reason" aria-label="Reason" />
              <SubmitButton size="sm" tone="danger">
                Cancel invoice
              </SubmitButton>
            </ActionForm>
          </details>
        )}
      </div>
    </DetailScreen>
  );
}
