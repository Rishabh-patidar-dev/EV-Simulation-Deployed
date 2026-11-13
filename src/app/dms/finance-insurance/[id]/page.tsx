import Link from "next/link";
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import DetailScreen, { DetailColumns } from "@/components/shell/DetailScreen";
import ActionForm from "@/components/ui/ActionForm";
import { Panel } from "@/components/ui/cards";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatDate } from "@/components/ui/primitives";
import { Facts, Hint, Stepper, Timeline, reachedFrom } from "@/components/ui/workflow";
import { SANCTION_SLA_HOURS } from "@/lib/finance";
import { rupees } from "@/lib/gst";
import { hoursSince } from "@/lib/time";
import { decideLoan, disburseLoan, receivePayout, submitLoan, updateLoanDocuments, withdrawLoan } from "@/server/actions/finance";
import { readMany } from "@/server/store";
import { LOAN_FLOW } from "@/server/types";

export const dynamic = "force-dynamic";

export default async function LoanCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await readMany(["finance_cases", "bookings", "financiers", "deliveries"] as const);
  const c = data.finance_cases.find((x) => x.id === id);
  if (!c) notFound();

  const booking = data.bookings.find((b) => b.id === c.bookingId);
  const financier = data.financiers.find((f) => f.id === c.financierId);
  const delivery = data.deliveries.find((d) => d.bookingId === c.bookingId && d.status !== "Cancelled");
  const step = (LOAN_FLOW as readonly string[]).indexOf(c.status);
  const missing = c.documents.filter((d) => !d.received);
  const reviewSince = [...c.history].reverse().find((e) => e.status === "Under Review")?.at;
  const reviewHours = c.status === "Under Review" && reviewSince ? Math.round(hoursSince(reviewSince)) : 0;
  const totalPaid = c.emi * c.tenureMonths;

  const actions =
    c.status === "Applied" ? (
      <>
        <ActionForm action={submitLoan.bind(null, c.id)}>
          <SubmitButton>Submit to {c.financier}</SubmitButton>
        </ActionForm>
        <Hint>{missing.length ? `${missing.length} document${missing.length === 1 ? "" : "s"} still to collect.` : "Every document is in."}</Hint>
      </>
    ) : c.status === "Under Review" ? (
      <Hint>
        With {c.financier} for {reviewHours}h{reviewHours > SANCTION_SLA_HOURS ? " — past the 72-hour sanction window, chase it" : ""}.
      </Hint>
    ) : null;

  return (
    <DetailScreen
      moduleHref="/dms/finance-insurance"
      title={c.caseNo}
      badges={
        <>
          <StatusPill value={c.status} />
          {reviewHours > SANCTION_SLA_HOURS && <Pill tone="negative">Over {SANCTION_SLA_HOURS}h</Pill>}
        </>
      }
      subtitle={`${c.customer} · ${c.quantity} × ${c.model} · ${c.financier} · applied ${formatDate(c.appliedAt)}`}
      actions={actions}
    >
      <Stepper
        label="Loan progress"
        steps={LOAN_FLOW}
        current={Math.max(0, step)}
        complete={c.status === "Disbursed"}
        reachedAt={reachedFrom(c.history)}
        stopped={
          c.status === "Rejected" || c.status === "Withdrawn"
            ? { title: `${c.status}.`, detail: [...c.history].reverse().find((e) => e.status === c.status)?.note ?? "No reason recorded." }
            : undefined
        }
      />

      <DetailColumns
        main={
          <>
            {(c.status === "Applied" || c.status === "Under Review") && (
              <Panel title="Documents" description="What the lender needs — tick each one as it comes in.">
                <ActionForm action={updateLoanDocuments.bind(null, c.id)} className="space-y-3">
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {c.documents.map((d) => (
                      <li key={d.name}>
                        <label className="flex items-center gap-2 text-[12.5px]">
                          <input type="checkbox" name="doc" value={d.name} defaultChecked={d.received} />
                          {d.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                  <SubmitButton size="sm" tone="ghost">
                    Save documents
                  </SubmitButton>
                </ActionForm>
              </Panel>
            )}

            {c.status === "Under Review" && (
              <Panel title="Lender's decision" description="Record what the lender came back with, and the bureau score it pulled.">
                <ActionForm action={decideLoan.bind(null, c.id)} className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <div>
                    <label className="field-label" htmlFor="loan-cibil">
                      Bureau score
                    </label>
                    <input id="loan-cibil" name="cibil" type="number" min={300} max={900} required className="field" placeholder="300–900" />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="loan-note">
                      Note (the reason, if declined)
                    </label>
                    <input id="loan-note" name="note" maxLength={300} className="field" placeholder="e.g. Income proof insufficient" />
                  </div>
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    <SubmitButton name="decision" value="Sanctioned">
                      Sanctioned
                    </SubmitButton>
                    <SubmitButton tone="danger" name="decision" value="Rejected">
                      Declined
                    </SubmitButton>
                  </div>
                </ActionForm>
              </Panel>
            )}

            {c.status === "Sanctioned" && (
              <Panel title="Disbursal" description="Once the lender pays the dealer. This releases the booking for delivery.">
                <ActionForm action={disburseLoan.bind(null, c.id)} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[14rem] flex-1">
                    <label className="field-label" htmlFor="loan-utr">
                      UTR of the transfer
                    </label>
                    <input id="loan-utr" name="utr" required minLength={12} maxLength={22} className="field uppercase" placeholder="e.g. HDFCR52026091912345" />
                  </div>
                  <SubmitButton>Record disbursal</SubmitButton>
                </ActionForm>
              </Panel>
            )}

            <Panel title="History" description="Every step, newest first.">
              <Timeline events={c.history} />
            </Panel>
          </>
        }
        side={
          <>
            <Panel title="Terms">
              <Facts
                rows={[
                  ["Booking value", rupees(c.vehicleValue)],
                  ["Down payment", `${rupees(c.downPayment)} (${Math.round((c.downPayment / c.vehicleValue) * 100)}%)`],
                  ["Loan amount", rupees(c.loanAmount)],
                  ["Rate", `${c.ratePct}% a year`],
                  ["Tenure", `${c.tenureMonths} months`],
                  ["EMI", rupees(c.emi)],
                  ["Total interest", rupees(totalPaid - c.loanAmount)],
                  ["Processing fee", rupees(c.processingFee)],
                  c.cibil !== null && ["Bureau score", String(c.cibil)],
                  c.sanctionRef && ["Sanction", c.sanctionRef],
                  c.utr && ["UTR", c.utr],
                ]}
              />
            </Panel>

            <Panel title="Dealer payout" description={financier ? `${financier.payoutPct}% of the loan from ${c.financier}` : undefined}>
              <div className="mb-2 flex items-center justify-between">
                <span className="num text-[16px] font-bold">{rupees(c.payout.amount)}</span>
                <Pill tone={c.payout.status === "Received" ? "positive" : c.payout.status === "Accrued" ? "warning" : "neutral"}>{c.payout.status === "Pending" ? "On disbursal" : c.payout.status}</Pill>
              </div>
              {c.payout.status === "Accrued" ? (
                <ActionForm action={receivePayout.bind(null, c.id)} className="flex gap-2">
                  <input name="reference" maxLength={40} className="field min-w-0 flex-1" placeholder="Remittance reference" aria-label="Remittance reference" />
                  <SubmitButton size="sm">Received</SubmitButton>
                </ActionForm>
              ) : (
                <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
                  {c.payout.status === "Received" ? `Received ${c.payout.receivedAt ? formatDate(c.payout.receivedAt) : ""} · ${c.payout.reference ?? ""}` : "Accrues when the loan is disbursed."}
                </p>
              )}
            </Panel>

            <Panel title="Booking" action={booking ? { href: `/crm/bookings?q=${encodeURIComponent(booking.bookingNo)}`, label: "Open in Bookings" } : undefined}>
              {booking ? (
                <Facts
                  rows={[
                    ["Booking", booking.bookingNo],
                    ["Status", <StatusPill key="s" value={booking.status} />],
                    ["Dealer", booking.dealer],
                    delivery && ["Delivery", <Link key="d" href={`/dms/orders/delivery/${delivery.id}`} className="underline">{delivery.deliveryNo} · {delivery.status}</Link>],
                  ]}
                />
              ) : (
                <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                  The booking is no longer on record.
                </p>
              )}
            </Panel>

            {(c.status === "Applied" || c.status === "Under Review" || c.status === "Sanctioned") && (
              <details className="disclosure surface">
                <summary className="flex items-center gap-2 px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--negative)" }}>
                  <TriangleAlert className="h-4 w-4" />
                  Withdraw the case…
                </summary>
                <ActionForm action={withdrawLoan.bind(null, c.id)} className="space-y-2.5 px-4 pb-4">
                  <textarea name="reason" required minLength={3} maxLength={300} rows={2} className="field" placeholder="e.g. Customer paying cash" aria-label="Reason" />
                  <SubmitButton size="sm" tone="danger">
                    Withdraw
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
