import Link from "next/link";
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import DetailScreen, { DetailColumns } from "@/components/shell/DetailScreen";
import ActionForm from "@/components/ui/ActionForm";
import { Panel } from "@/components/ui/cards";
import FlashToast from "@/components/ui/FlashToast";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { Facts, Hint, Stepper, Timeline, reachedFrom } from "@/components/ui/workflow";
import { amountInWords, rupees } from "@/lib/gst";
import { DISCOUNT_LIMIT_PCT, quoteStatus, quoteTotals } from "@/lib/quotes";
import { vehicleImage } from "@/lib/vehicles";
import { convertQuotation, declineQuotation, deleteQuotation, markQuotationAccepted, reviseQuotation, sendQuotation } from "@/server/actions/quotations";
import { readMany } from "@/server/store";

export const dynamic = "force-dynamic";

const STEPS = ["Draft", "Sent", "Accepted", "Converted"] as const;

export default async function QuotationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  const { data } = await readMany(["quotations", "approvals", "bookings", "tax_invoices", "deals"] as const);
  const q = data.quotations.find((x) => x.id === id);
  if (!q) notFound();

  const status = quoteStatus(q);
  const t = quoteTotals(q);
  const approval = q.approvalId ? data.approvals.find((a) => a.id === q.approvalId) : undefined;
  const booking = q.bookingId ? data.bookings.find((b) => b.id === q.bookingId) : undefined;
  const invoice = data.tax_invoices.find((i) => i.quotationId === q.id && i.status === "Issued");
  const deal = q.dealId ? data.deals.find((d) => d.id === q.dealId) : undefined;
  const current = status === "Converted" ? 3 : status === "Accepted" ? 2 : status === "Sent" ? 1 : 0;
  const revisable = ["Draft", "Sent", "Pending Approval", "Expired"].includes(status);
  const declinable = ["Draft", "Sent", "Pending Approval", "Accepted"].includes(status);

  const primary =
    status === "Draft" ? (
      <>
        <ActionForm action={sendQuotation.bind(null, q.id)}>
          <SubmitButton>{t.needsApproval && approval?.status !== "Approved" ? "Send for discount approval" : "Send to customer"}</SubmitButton>
        </ActionForm>
        <Hint>{t.needsApproval && approval?.status !== "Approved" ? `${t.discountPct}% is over the ${DISCOUNT_LIMIT_PCT}% limit.` : "Shares it on WhatsApp."}</Hint>
      </>
    ) : status === "Sent" ? (
      <>
        <ActionForm action={markQuotationAccepted.bind(null, q.id)}>
          <SubmitButton>Customer accepted</SubmitButton>
        </ActionForm>
        <Hint>Valid until {formatDate(q.validUntil)}.</Hint>
      </>
    ) : status === "Accepted" ? (
      <>
        <ActionForm action={convertQuotation.bind(null, q.id)}>
          <SubmitButton>Convert to booking</SubmitButton>
        </ActionForm>
        <Hint>Creates the booking and sends a payment link for the 10% token.</Hint>
      </>
    ) : null;

  return (
    <DetailScreen
      moduleHref="/dms/quotations"
      title={q.quoteNo}
      badges={
        <>
          <StatusPill value={status} />
          {q.customerGstin && <Pill tone="brand">B2B</Pill>}
          {t.interState ? <Pill tone="neutral">Inter-state · IGST</Pill> : <Pill tone="neutral">Intra-state · CGST + SGST</Pill>}
        </>
      }
      subtitle={`${q.customer} · ${q.dealer} · drafted ${formatDate(q.createdAt)} by ${q.createdBy}`}
      actions={primary}
    >
      {created && <FlashToast param="created" message={`Quotation ${created.slice(0, 40)} drafted`} />}
      <Stepper
        label="Quotation progress"
        steps={STEPS}
        current={current}
        complete={status === "Converted"}
        reachedAt={reachedFrom(q.history)}
        stopped={
          status === "Rejected"
            ? { title: "Declined.", detail: [...q.history].reverse().find((e) => e.status === "Rejected")?.note ?? "No reason recorded." }
            : status === "Expired"
              ? { title: "Expired.", detail: `Valid until ${formatDate(q.validUntil)} — revise it to extend.` }
              : undefined
        }
      />

      <DetailColumns
        main={
          <>
            <Panel title="Lines" description={t.interState ? `IGST — ${q.dealerState} to ${q.customerState}` : `CGST + SGST — within ${q.dealerState}`} bodyClassName="p-0!">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>HSN/SAC</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Rate</th>
                      <th className="text-right">Discount</th>
                      <th className="text-right">Taxable</th>
                      <th className="text-right">GST</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.lines.map((line, i) => {
                      const image = line.model ? vehicleImage(line.model) : undefined;
                      return (
                        <tr key={i}>
                          <td>
                            <span className="flex items-center gap-2.5">
                              {image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={image} alt="" className="h-9 w-12 shrink-0 rounded-[6px] object-cover" style={{ background: "var(--bg)" }} />
                              ) : null}
                              <span className="min-w-0">
                                <span className="block font-medium">{line.description}</span>
                                <span className="block text-[11px]" style={{ color: "var(--fg-faint)" }}>
                                  {line.kind}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className="num">{line.hsn}</td>
                          <td className="num text-right">{line.quantity}</td>
                          <td className="num text-right">{rupees(line.unitPrice)}</td>
                          <td className="num text-right">{line.discount ? `−${rupees(line.discount)}` : "—"}</td>
                          <td className="num text-right">{rupees(line.taxable)}</td>
                          <td className="num text-right whitespace-nowrap">
                            {line.gstRate ? `${line.gstRate}% · ${rupees(line.cgst + line.sgst + line.igst)}` : "Nil"}
                          </td>
                          <td className="num text-right font-semibold">{rupees(line.total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="History" description="Every step, newest first.">
              <Timeline events={q.history} />
            </Panel>
          </>
        }
        side={
          <>
            <Panel title="Amount">
              <Facts
                rows={[
                  ["Gross", rupees(t.gross)],
                  t.discount > 0 && [`Discount (${t.discountPct}%)`, `−${rupees(t.discount)}`],
                  ["Taxable value", rupees(t.taxable)],
                  ...(t.interState
                    ? [["IGST", rupees(t.igst)] as [string, string]]
                    : [["CGST", rupees(t.cgst)] as [string, string], ["SGST", rupees(t.sgst)] as [string, string]]),
                  ["Invoice total", rupees(t.total)],
                  t.subsidy > 0 && ["Less PM E-DRIVE incentive", `−${rupees(t.subsidy)}`],
                ]}
              />
              <div className="mt-2 flex items-baseline justify-between gap-3 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                <span className="font-semibold">Customer pays</span>
                <span className="num text-[18px] font-bold">{rupees(t.payable)}</span>
              </div>
              <p className="mt-1 text-[11px]" style={{ color: "var(--fg-muted)" }}>
                {amountInWords(t.payable)}
              </p>
              {t.subsidy > 0 && (
                <p className="mt-2 text-[11px] leading-snug" style={{ color: "var(--fg-muted)" }}>
                  PM E-DRIVE: ₹2,500 per kWh, capped at ₹12,500 a vehicle, for registered e-rickshaws and e-carts until 31 March 2028. Claimed by the OEM and passed on to the buyer.
                </p>
              )}
            </Panel>

            {q.approvalId && (
              <Panel title="Discount approval" action={{ href: "/erp/access#approvals", label: "Open the approval queue" }}>
                {approval ? (
                  <>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-[12.5px]">{approval.pendingWith}</span>
                      <StatusPill value={approval.status ?? "Pending"} />
                    </div>
                    {approval.detail && <p className="text-[12px]">{approval.detail}</p>}
                    {approval.note && (
                      <p className="mt-2 text-[12px]" style={{ color: "var(--fg-muted)" }}>
                        “{approval.note}” — {approval.decidedBy}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                    The approval request is no longer on record.
                  </p>
                )}
              </Panel>
            )}

            <Panel title="Customer">
              <Facts
                rows={[
                  ["Name", q.customer],
                  ["Mobile", q.phone],
                  ["Place of supply", q.customerState],
                  ["GSTIN", q.customerGstin ?? "Unregistered (B2C)"],
                  ["Dealer", `${q.dealer}, ${q.dealerState}`],
                  deal && ["Deal", <Link key="deal" href={`/crm/pipeline?q=${encodeURIComponent(deal.customer)}`} className="underline">{deal.stage} on the pipeline</Link>],
                  ["Valid until", formatDate(q.validUntil)],
                ]}
              />
            </Panel>

            {(booking || invoice) && (
              <Panel title="Downstream">
                <Facts
                  rows={[
                    booking && ["Booking", <Link key="b" href={`/crm/bookings?q=${encodeURIComponent(booking.bookingNo)}`} className="underline">{booking.bookingNo} · {booking.status}</Link>],
                    invoice && ["Tax invoice", <Link key="i" href={`/dms/quotations/invoices/${invoice.id}`} className="underline">{invoice.invoiceNo}</Link>],
                  ]}
                />
              </Panel>
            )}

            {revisable && (
              <details className="disclosure surface">
                <summary className="px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                  Revise discount or validity…
                </summary>
                <ActionForm action={reviseQuotation.bind(null, q.id)} className="space-y-2.5 px-4 pb-4">
                  <label className="field-label" htmlFor="revise-discount">
                    Discount (₹, before GST) — up to {formatINR((t.vehicleValue * DISCOUNT_LIMIT_PCT) / 100)} needs no approval
                  </label>
                  <input id="revise-discount" name="discount" type="number" min={0} max={t.vehicleValue} step={1} defaultValue={q.discount} className="field" />
                  <label className="field-label" htmlFor="revise-valid">
                    Valid until (optional)
                  </label>
                  <input id="revise-valid" name="validUntil" type="date" className="field" />
                  <SubmitButton size="sm">Save revision</SubmitButton>
                </ActionForm>
              </details>
            )}

            {declinable && (
              <details className="disclosure surface">
                <summary className="flex items-center gap-2 px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--negative)" }}>
                  <TriangleAlert className="h-4 w-4" />
                  Customer declined…
                </summary>
                <ActionForm action={declineQuotation.bind(null, q.id)} className="space-y-2.5 px-4 pb-4">
                  <label className="field-label" htmlFor="decline-reason">
                    Reason
                  </label>
                  <textarea id="decline-reason" name="reason" required minLength={3} maxLength={300} rows={3} className="field" placeholder="e.g. Chose a competitor on price" />
                  <SubmitButton size="sm" tone="danger">
                    Mark declined
                  </SubmitButton>
                </ActionForm>
              </details>
            )}

            {/* A draft nobody has seen — anything sent is declined instead. */}
            {q.status === "Draft" && !q.approvalId && (
              <details className="disclosure surface">
                <summary className="flex items-center gap-2 px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--negative)" }}>
                  <TriangleAlert className="h-4 w-4" />
                  Delete this draft…
                </summary>
                <ActionForm action={deleteQuotation.bind(null, q.id)} className="space-y-2.5 px-4 pb-4">
                  <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
                    {q.quoteNo} goes for good. Nothing has been sent to {q.customer}.
                  </p>
                  <SubmitButton size="sm" tone="danger">
                    Yes, delete {q.quoteNo}
                  </SubmitButton>
                </ActionForm>
              </details>
            )}
          </>
        }
      />
    </DetailScreen>
  );
}
