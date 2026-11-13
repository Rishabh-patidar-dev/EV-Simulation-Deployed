import Link from "next/link";
import { notFound } from "next/navigation";
import DetailScreen, { DetailColumns } from "@/components/shell/DetailScreen";
import ActionForm from "@/components/ui/ActionForm";
import { Panel } from "@/components/ui/cards";
import PrintButton from "@/components/ui/PrintButton";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { Facts, Hint, fullDate } from "@/components/ui/workflow";
import { HSN, amountInWords, derivedGstin } from "@/lib/gst";
import { balance, credited, daysPastDue, dueTone, invoiceState } from "@/lib/receivables";
import { raiseCreditNote, recordInvoicePayment, sendPaymentReminder } from "@/server/actions/invoices";
import { readMany } from "@/server/store";

export const dynamic = "force-dynamic";

/** Luxus Green bills its dealers from the Bilaspur plant. */
const OEM = { name: "Luxus Green Mobility Pvt Ltd", place: "Bilaspur, Chhattisgarh", state: "Chhattisgarh" };

/**
 * One dealer invoice — the document itself (seller, dealer, lines, GST split
 * by place of supply, total in words) and everything that has happened to it
 * since: receipts, credit notes and reminders, with the next thing to do.
 */
export default async function DealerInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await readMany(["invoices", "dealers", "orders", "sync_queue", "payments"] as const);
  const inv = data.invoices.find((i) => i.id === id);
  if (!inv) notFound();

  const dealer = data.dealers.find((d) => d.name === inv.dealer);
  const order = inv.orderId ? data.orders.find((o) => o.id === inv.orderId) : data.orders.find((o) => o.invoiceId === inv.id);
  const state = invoiceState(inv);
  const open = balance(inv);
  const late = daysPastDue(inv);
  const interState = (dealer?.state ?? OEM.state) !== OEM.state;

  // The invoice is raised at order value plus 5% GST; the lines are the order's, at their dealer price.
  const lines = order?.lines ?? [];
  const taxable = lines.length ? lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) : Math.round(inv.amount / 1.05);
  const gst = inv.amount - taxable;
  const vouchers = data.sync_queue.filter((v) => v.sourceId === inv.id);
  const link = data.payments.find((p) => p.related?.id === inv.id && p.status === "Created");

  return (
    <DetailScreen
      moduleHref="/dms/orders/invoices"
      title={inv.invoiceNo}
      badges={
        <>
          <StatusPill value={state} />
          {state === "Overdue" && <Pill tone="negative">{late} days late</Pill>}
        </>
      }
      subtitle={
        <>
          {inv.type} invoice to{" "}
          {dealer ? (
            <Link href={`/dms/orders/invoices/dealers/${dealer.id}`} className="underline">
              {inv.dealer}
            </Link>
          ) : (
            inv.dealer
          )}{" "}
          · issued {formatDate(inv.issuedAt)} · due {formatDate(inv.dueOn)}
        </>
      }
      actions={<PrintButton label="Print invoice" />}
    >
      <DetailColumns
        main={
          <>
            <article className="surface w-full p-6 text-[12.5px] print:border-0 print:p-0 print:shadow-none" aria-label="Invoice">
              <header className="flex flex-wrap items-start justify-between gap-4 pb-4" style={{ borderBottom: "2px solid var(--fg)" }}>
                <div>
                  <p className="text-[18px] font-bold">{OEM.name}</p>
                  <p style={{ color: "var(--fg-muted)" }}>{OEM.place}</p>
                  <p className="num mt-1">GSTIN {derivedGstin(OEM.name, OEM.state)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[16px] font-bold tracking-wide">TAX INVOICE</p>
                  <p className="num">{inv.invoiceNo}</p>
                  <p>{fullDate(inv.issuedAt)}</p>
                  {order && (
                    <p>
                      Against{" "}
                      <Link href={`/dms/orders/${order.id}`} className="underline">
                        {order.orderNo}
                      </Link>
                    </p>
                  )}
                </div>
              </header>
              <section className="grid gap-4 py-4 sm:grid-cols-2" style={{ borderBottom: "1px solid var(--border)" }}>
                <div>
                  <p className="field-label">Billed to</p>
                  <p className="font-semibold">{inv.dealer}</p>
                  {dealer && <p>{`${dealer.city}, ${dealer.state}`}</p>}
                  <p className="num">GSTIN {dealer?.gstin ?? (dealer ? derivedGstin(dealer.name, dealer.state) : "—")}</p>
                </div>
                <div className="sm:text-right">
                  <p className="field-label">Place of supply</p>
                  <p>{dealer?.state ?? OEM.state}</p>
                  <p style={{ color: "var(--fg-muted)" }}>{interState ? "Inter-state — IGST" : "Intra-state — CGST + SGST"}</p>
                </div>
              </section>
              <div className="overflow-x-auto py-2">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>HSN</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Rate</th>
                      <th className="text-right">Taxable value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length ? (
                      lines.map((l, n) => (
                        <tr key={n}>
                          <td>
                            {l.model} — {l.variant}
                          </td>
                          <td className="num">{HSN.passengerVehicle}</td>
                          <td className="num text-right">{l.quantity}</td>
                          <td className="num text-right">{formatINR(l.unitPrice)}</td>
                          <td className="num text-right">{formatINR(l.quantity * l.unitPrice)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4}>{inv.type} supply — line detail was not recorded</td>
                        <td className="num text-right">{formatINR(taxable)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <dl className="ml-auto mt-2 w-full max-w-xs space-y-1.5">
                <Row label="Taxable value" value={formatINR(taxable)} />
                {interState ? (
                  <Row label="IGST 5%" value={formatINR(gst)} />
                ) : (
                  <>
                    <Row label="CGST 2.5%" value={formatINR(Math.floor(gst / 2))} />
                    <Row label="SGST 2.5%" value={formatINR(gst - Math.floor(gst / 2))} />
                  </>
                )}
                <div className="flex items-baseline justify-between gap-3 pt-1.5" style={{ borderTop: "1px solid var(--border)" }}>
                  <dt className="font-semibold">Invoice total</dt>
                  <dd className="num text-[15px] font-bold">{formatINR(inv.amount)}</dd>
                </div>
              </dl>
              <p className="mt-3" style={{ color: "var(--fg-muted)" }}>
                {amountInWords(inv.amount)}
              </p>
              <p className="mt-3 text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                Payable within {dealer?.creditDays ?? 30} days of the invoice date. Seller details are the simulation&apos;s own.
              </p>
            </article>

            <Panel title="Receipts" bodyClassName={inv.payments?.length ? "p-0!" : ""}>
              {inv.payments?.length ? (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Mode</th>
                        <th>Reference</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.payments.map((p, n) => (
                        <tr key={n}>
                          <td>
                            {fullDate(p.at)} · {p.by}
                          </td>
                          <td>{p.mode}</td>
                          <td className="font-mono text-[12px]">{p.reference}</td>
                          <td className="num text-right font-semibold">{formatINR(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>
                  Nothing received yet.
                </p>
              )}
            </Panel>

            {(inv.creditNotes?.length ?? 0) > 0 && (
              <Panel title="Credit notes" bodyClassName="p-0!">
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Credit note</th>
                        <th>Reason</th>
                        <th>When</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.creditNotes!.map((c) => (
                        <tr key={c.no}>
                          <td className="font-medium">{c.no}</td>
                          <td>{c.reason}</td>
                          <td>
                            {formatDate(c.at)} · {c.by}
                          </td>
                          <td className="num text-right font-semibold">{formatINR(c.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}

            {(inv.reminders?.length ?? 0) > 0 && (
              <Panel title="Reminders">
                <ul className="space-y-1.5 text-[12.5px]">
                  {[...inv.reminders!].reverse().map((r, n) => (
                    <li key={n} className="flex flex-wrap items-center gap-2">
                      <StatusPill value={r.status} /> {fullDate(r.at)} · to {r.to}
                      {r.error && <span style={{ color: "var(--negative)" }}>— {r.error}</span>}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>
        }
        side={
          <>
            <Panel title="Balance">
              <Facts
                rows={[
                  ["Invoiced", formatINR(inv.amount)],
                  ["Received", formatINR(inv.received)],
                  credited(inv) > 0 && ["Credited", formatINR(credited(inv))],
                  ["Balance", <span key="b" style={{ color: dueTone(inv) === "negative" ? "var(--negative)" : undefined }}>{formatINR(open)}</span>],
                  ["Due", formatDate(inv.dueOn)],
                ]}
              />
              {link && (
                <p className="mt-3 text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                  A payment link for {formatINR(link.amount)} is out ({link.gatewayRef}) —{" "}
                  <Link href="/erp/integrations/payments" className="underline">
                    capture it in Payments
                  </Link>
                  .
                </p>
              )}
            </Panel>

            {open > 0 && (
              <Panel title="Record a receipt">
                <ActionForm action={recordInvoicePayment.bind(null, inv.id)} resetOnSuccess className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="field-label" htmlFor="rc-amount">
                        Amount (₹)
                      </label>
                      <input id="rc-amount" name="amount" type="number" min={1} max={open} defaultValue={open} required className="field" />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="rc-mode">
                        Mode
                      </label>
                      <select id="rc-mode" name="mode" className="field" defaultValue="NEFT/RTGS">
                        <option>NEFT/RTGS</option>
                        <option>UPI</option>
                        <option>Cheque</option>
                      </select>
                    </div>
                  </div>
                  <input name="reference" required minLength={4} maxLength={40} className="field" placeholder="UTR / cheque no." aria-label="Reference" />
                  <SubmitButton size="sm">Record receipt</SubmitButton>
                </ActionForm>
              </Panel>
            )}

            {open > 0 && (
              <Panel title="Remind the dealer">
                <ActionForm action={sendPaymentReminder.bind(null, inv.id)} className="space-y-2">
                  <SubmitButton size="sm" tone="ghost">
                    Send WhatsApp reminder
                  </SubmitButton>
                  <Hint>Goes to the dealer&apos;s active login in User Management, on the payment_reminder template.</Hint>
                </ActionForm>
              </Panel>
            )}

            {open > 0 && (
              <details className="disclosure surface">
                <summary className="px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                  Raise a credit note…
                </summary>
                <ActionForm action={raiseCreditNote.bind(null, inv.id)} className="space-y-2.5 px-4 pb-4">
                  <input name="amount" type="number" min={1} max={open} required className="field" placeholder={`Up to ${formatINR(open)}`} aria-label="Amount" />
                  <input name="reason" required minLength={5} maxLength={300} className="field" placeholder="e.g. Price correction agreed with the dealer" aria-label="Reason" />
                  <SubmitButton size="sm">Issue credit note</SubmitButton>
                  <Hint>Reduces the balance and the dealer&apos;s outstanding, and reverses the sale and its GST in the books.</Hint>
                </ActionForm>
              </details>
            )}

            {vouchers.length > 0 && (
              <Panel title="In the books" action={{ href: `/erp/accounting?q=${encodeURIComponent(inv.invoiceNo)}`, label: "Open in ERP / Accounting" }}>
                <ul className="space-y-1.5 text-[12.5px]">
                  {vouchers.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-2">
                      <span>
                        {v.voucherType} · {formatINR(v.amount)}
                      </span>
                      <StatusPill value={v.status} />
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>
        }
      />
    </DetailScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt style={{ color: "var(--fg-muted)" }}>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
