import Link from "next/link";
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import DetailScreen, { DetailColumns } from "@/components/shell/DetailScreen";
import ActionForm from "@/components/ui/ActionForm";
import { Panel } from "@/components/ui/cards";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { Facts, Hint, Stepper, Timeline, reachedFrom } from "@/components/ui/workflow";
import { cancelPartOrder, checkPartStock, deliverPartOrder, dispatchPartOrder, sendPartNotice, shipAvailableParts } from "@/server/actions/partOrders";
import { readMany } from "@/server/store";
import { PART_ORDER_FLOW } from "@/server/types";

export const dynamic = "force-dynamic";

/** One dealer parts order: its lines against live stock, what happens next, and its history. */
export default async function PartOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await readMany(["part_orders", "spare_parts", "invoices"] as const);
  const o = data.part_orders.find((x) => x.id === id);
  if (!o) notFound();

  const invoice = o.invoiceId ? data.invoices.find((i) => i.id === o.invoiceId) : undefined;
  const backOrder = o.backOrderId ? data.part_orders.find((x) => x.id === o.backOrderId) : undefined;
  const parent = o.backOrderOf ? data.part_orders.find((x) => x.id === o.backOrderOf) : undefined;
  const short = o.status === "Short";
  const live = o.lines.map((l) => ({ ...l, onHand: data.spare_parts.find((p) => p.id === l.partId)?.onHand ?? 0 }));
  const step = o.status === "Cancelled" ? 0 : short ? 0 : PART_ORDER_FLOW.indexOf(o.status as (typeof PART_ORDER_FLOW)[number]);

  return (
    <DetailScreen
      moduleHref="/dms/inventory/spare-parts"
      title={o.orderNo}
      badges={
        <>
          <StatusPill value={o.status} />
          {o.backOrderOf && <Pill tone="info">Back-order</Pill>}
        </>
      }
      subtitle={
        <>
          {o.dealer} · placed {formatDate(o.placedAt)} · {formatINR(o.value)} before GST ·{" "}
          <Link href="/dms/inventory/spare-parts/orders" className="underline">
            all dealer orders
          </Link>
        </>
      }
      actions={
        o.status === "Requested" || short ? (
          <ActionForm action={checkPartStock.bind(null, o.id)}>
            <SubmitButton>{short ? "Re-check stock" : "Check stock & confirm"}</SubmitButton>
          </ActionForm>
        ) : o.status === "Confirmed" ? (
          <>
            <ActionForm action={dispatchPartOrder.bind(null, o.id)}>
              <SubmitButton>Dispatch & invoice</SubmitButton>
            </ActionForm>
            <Hint>Raises the GST invoice on the dealer&apos;s account.</Hint>
          </>
        ) : o.status === "Dispatched" ? (
          <ActionForm action={deliverPartOrder.bind(null, o.id)}>
            <SubmitButton>Mark delivered</SubmitButton>
          </ActionForm>
        ) : undefined
      }
    >
      <Stepper
        label="Order progress"
        steps={PART_ORDER_FLOW}
        current={step}
        complete={o.status === "Delivered"}
        reachedAt={reachedFrom(o.history)}
        stopped={o.status === "Cancelled" ? { title: "Cancelled.", detail: o.cancelReason ?? "" } : short ? { title: "Short of stock.", detail: "Re-check once stock arrives, send the dealer a notice, or ship what is there." } : undefined}
      />
      <DetailColumns
        main={
          <>
            <Panel title="Lines" bodyClassName="p-0!">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Part</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Price</th>
                      <th className="text-right">Amount</th>
                      {(o.status === "Requested" || short) && <th className="text-right">On hand now</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {live.map((l) => (
                      <tr key={l.partId}>
                        <td>
                          <span className="font-medium">{l.sku}</span> · {l.name}
                        </td>
                        <td className="num text-right">{l.quantity}</td>
                        <td className="num text-right">{formatINR(l.unitPrice)}</td>
                        <td className="num text-right">{formatINR(l.quantity * l.unitPrice)}</td>
                        {(o.status === "Requested" || short) && (
                          <td className="num text-right" style={{ color: l.onHand >= l.quantity ? "var(--positive)" : "var(--negative)" }}>
                            {l.onHand}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            {short && (
              <Panel title="Short of stock">
                <div className="space-y-3">
                  {live.some((l) => l.onHand > 0) && (
                    <ActionForm action={shipAvailableParts.bind(null, o.id)}>
                      <SubmitButton tone="ghost">Ship what&apos;s on the shelf, back-order the rest</SubmitButton>
                    </ActionForm>
                  )}
                  <ActionForm action={sendPartNotice.bind(null, o.id)} className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
                    <div>
                      <label className="field-label" htmlFor="pn-date">
                        Expected restock
                      </label>
                      <input id="pn-date" name="expectedRestock" type="date" className="field" />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="pn-msg">
                        Message
                      </label>
                      <input id="pn-msg" name="message" maxLength={300} className="field" />
                    </div>
                    <SubmitButton tone="ghost">Send notice</SubmitButton>
                  </ActionForm>
                  {o.notice && (
                    <Hint>
                      Notice sent {formatDate(o.notice.sentAt)}
                      {o.notice.expectedRestock ? ` · restock ${formatDate(o.notice.expectedRestock)}` : ""}
                      {o.notice.message ? ` · ${o.notice.message}` : ""}
                    </Hint>
                  )}
                </div>
              </Panel>
            )}

            <Panel title="History" description="Every step, newest first.">
              <Timeline events={o.history} />
            </Panel>
          </>
        }
        side={
          <>
            <Panel title="Billing" action={invoice ? { href: `/dms/orders/invoices/${invoice.id}`, label: "Open the invoice" } : undefined}>
              <Facts
                rows={[
                  ["Value", formatINR(o.value)],
                  ["GST 18%", formatINR(Math.round(o.value * 0.18))],
                  ["Total", formatINR(Math.round(o.value * 1.18))],
                  invoice && ["Invoice", `${invoice.invoiceNo}`],
                ]}
              />
              {!invoice && <Hint>Invoiced at dispatch.</Hint>}
            </Panel>
            {(backOrder || parent) && (
              <Panel title="Linked">
                <p className="text-[12.5px]">
                  {backOrder && (
                    <>
                      Rest back-ordered as{" "}
                      <Link href={`/dms/inventory/spare-parts/orders/${backOrder.id}`} className="underline">
                        {backOrder.orderNo}
                      </Link>{" "}
                      ({backOrder.status}).
                    </>
                  )}
                  {parent && (
                    <>
                      Back-order of{" "}
                      <Link href={`/dms/inventory/spare-parts/orders/${parent.id}`} className="underline">
                        {parent.orderNo}
                      </Link>
                      .
                    </>
                  )}
                </p>
              </Panel>
            )}
            {["Requested", "Short", "Confirmed"].includes(o.status) && (
              <details className="disclosure surface">
                <summary className="flex items-center gap-2 px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--negative)" }}>
                  <TriangleAlert className="h-4 w-4" />
                  Cancel this order…
                </summary>
                <ActionForm action={cancelPartOrder.bind(null, o.id)} className="space-y-2 px-4 pb-4">
                  <textarea name="reason" required minLength={3} maxLength={300} rows={2} className="field" placeholder="Reason" aria-label="Reason" />
                  <SubmitButton size="sm" tone="danger">
                    Cancel order
                  </SubmitButton>
                  {o.status === "Confirmed" && <Hint>The picked parts go back on the shelf.</Hint>}
                </ActionForm>
              </details>
            )}
          </>
        }
      />
    </DetailScreen>
  );
}
