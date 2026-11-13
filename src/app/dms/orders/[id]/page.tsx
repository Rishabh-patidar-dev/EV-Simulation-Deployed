import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronRight, CircleX, TriangleAlert } from "lucide-react";
import ActionForm from "@/components/ui/ActionForm";
import { MetricTiles, Panel } from "@/components/ui/cards";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatDate, formatINR, relativeTime } from "@/components/ui/primitives";
import { GST_RATE, isLate } from "@/lib/orders";
import { invoiceState } from "@/lib/receivables";
import { vehicleImage } from "@/lib/vehicles";
import { advanceOrder, cancelOrder, recheckStock, sendStockNotice, shipAvailable } from "@/server/actions/orders";
import { checkLines, freeOemStock, reservedTo } from "@/lib/stock";
import { readMany } from "@/server/store";
import { ORDER_FLOW, type Order } from "@/server/types";

export const dynamic = "force-dynamic";

/** What the primary button does from each status. */
const NEXT_ACTION: Record<(typeof ORDER_FLOW)[number], { label: string; hint: string } | null> = {
  Placed: { label: "Check stock & confirm", hint: "Confirms and reserves the vehicles when OEM stock covers every line; otherwise it goes on the short list." },
  Acknowledged: { label: "Start PDI & loading", hint: "The reserved vehicles are prepared at the plant." },
  "In Production": { label: "Dispatch & invoice", hint: "Ships the reserved vehicles and raises the GST invoice." },
  Dispatched: { label: "Mark received", hint: "Records that the dealer has the vehicles." },
  Received: null,
};

const CANCELLABLE: ReadonlyArray<Order["status"]> = ["Placed", "Stock Short", "Acknowledged", "In Production"];

const fullDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * One dealer order: its lines, money, dealer and history, and the one or two
 * things that can happen to it next.
 */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await readMany(["orders", "dealers", "invoices", "vehicle_units"] as const);
  const order = data.orders.find((o) => o.id === id);
  if (!order) notFound();

  const dealer = data.dealers.find((d) => d.name === order.dealer);
  const invoice = order.invoiceId ? data.invoices.find((i) => i.id === order.invoiceId) : undefined;
  const late = isLate(order);
  const cancelled = order.status === "Cancelled";
  const short = order.status === "Stock Short";
  // A short order has not got past Placed.
  const step = cancelled ? -1 : short ? 0 : ORDER_FLOW.indexOf(order.status as (typeof ORDER_FLOW)[number]);
  const next = cancelled || short ? null : NEXT_ACTION[order.status as (typeof ORDER_FLOW)[number]];
  const live = checkLines(order, freeOemStock(data.vehicle_units, data.dealers));
  const reserved = reservedTo(data.vehicle_units, order.id);
  const shipped = data.vehicle_units.filter((u) => u.orderId === order.id && u.status !== "Allocated");
  const backOrder = order.backOrderId ? data.orders.find((o) => o.id === order.backOrderId) : undefined;
  const parent = order.backOrderOf ? data.orders.find((o) => o.id === order.backOrderOf) : undefined;
  const gst = Math.round(order.value * GST_RATE);
  const history = [...(order.history ?? [])].reverse();

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="space-y-2">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
          <Link href="/" className="hover:text-[color:var(--fg)]">
            Dashboard
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span>Dealer Management System</span>
          <ChevronRight className="h-3 w-3" />
          <Link href="/dms/orders" className="hover:text-[color:var(--fg)]">
            Order Management
          </Link>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold leading-tight tracking-tight">{order.orderNo}</h1>
              <StatusPill value={order.status} />
              {late && <Pill tone="negative">Late</Pill>}
            </div>
            <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
              {order.dealer} · placed {formatDate(order.placedAt)}
              {order.placedBy ? ` by ${order.placedBy}` : ""} · expected {formatDate(order.expectedBy)}
            </p>
          </div>

          {order.creditHold && (
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <Pill tone="warning">Credit hold</Pill>
              <p className="max-w-xs text-right text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                {formatINR(order.creditHold.exposure)} owed against a {formatINR(order.creditHold.limit)} limit —{" "}
                <Link href="/erp/access#approvals" className="underline">
                  waiting for the Finance Controller
                </Link>
              </p>
            </div>
          )}
          {next && !order.creditHold && (
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <ActionForm action={advanceOrder.bind(null, order.id)}>
                <SubmitButton>{next.label}</SubmitButton>
              </ActionForm>
              <p className="text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                {next.hint}
              </p>
            </div>
          )}
        </div>
      </header>

      {/* ── progress ─────────────────────────────────────────────────── */}
      <section aria-label="Order progress" className="surface px-4 py-3.5">
        {cancelled ? (
          <p className="flex items-start gap-2 text-[13px]">
            <CircleX className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--negative)" }} />
            <span>
              <span className="font-semibold">Cancelled.</span>{" "}
              <span style={{ color: "var(--fg-muted)" }}>{order.cancelReason ?? "No reason was recorded."}</span>
            </span>
          </p>
        ) : (
          <ol className="grid gap-2 sm:grid-cols-5">
            {ORDER_FLOW.map((status, i) => {
              const reached = history.find((e) => e.status === status);
              const done = i < step || (i === step && status === "Received");
              const current = i === step && status !== "Received";
              return (
                <li key={status} className="flex items-center gap-2.5 sm:flex-col sm:items-start">
                  <span className="flex items-center gap-2 sm:w-full">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                      style={
                        done
                          ? { background: "var(--brand)", color: "#0e2107" }
                          : current
                            ? { background: "var(--brand-soft)", color: "var(--brand-ink)", boxShadow: "0 0 0 2px var(--brand)" }
                            : { background: "var(--surface-subtle)", color: "var(--fg-faint)", border: "1px solid var(--border)" }
                      }
                    >
                      {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    {i < ORDER_FLOW.length - 1 && (
                      <span className="hidden h-0.5 flex-1 rounded-full sm:block" style={{ background: i < step ? "var(--brand)" : "var(--border)" }} />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[12.5px] ${current ? "font-semibold" : ""}`} style={i > step ? { color: "var(--fg-faint)" } : undefined}>
                      {status}
                    </span>
                    <span className="block text-[11px]" style={{ color: "var(--fg-faint)" }}>
                      {reached ? formatDate(reached.at) : i > step ? "Not yet" : "—"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid min-w-0 gap-4">
          <Panel title="Lines" description={`${order.lineItems} line${order.lineItems === 1 ? "" : "s"} · ${order.units} units`} bodyClassName="p-0!">
            {order.lines?.length ? (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Variant</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Unit price</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.map((line, i) => {
                      const image = vehicleImage(line.model);
                      return (
                        <tr key={i}>
                          <td>
                            <span className="flex items-center gap-2.5">
                              {image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={image} alt="" className="h-9 w-12 shrink-0 rounded-[6px] object-cover" style={{ background: "var(--bg)" }} />
                              ) : null}
                              <span className="font-medium">{line.model}</span>
                            </span>
                          </td>
                          <td>{line.variant}</td>
                          <td className="num text-right">{line.quantity}</td>
                          <td className="num text-right">{formatINR(line.unitPrice)}</td>
                          <td className="num text-right font-semibold">{formatINR(line.quantity * line.unitPrice)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-[13px]" style={{ color: "var(--fg-muted)" }}>
                Line detail was not recorded for this order — only its totals: {order.lineItems} lines, {order.units} units.
              </p>
            )}
          </Panel>

          <Panel
            title="Stock"
            description={
              order.stockCheck
                ? `Checked ${fullDate(order.stockCheck.at)} by ${order.stockCheck.by} — ${order.stockCheck.sufficient ? "covered" : "short"}. Live OEM stock now:`
                : "Not checked against OEM stock yet. Live OEM stock now:"
            }
            headerExtra={short ? <Pill tone="warning">Stock short</Pill> : reserved.length ? <Pill tone="positive">{reserved.length} reserved</Pill> : undefined}
          >
            {live.length ? (
              <ul className="space-y-1.5 text-[12.5px]">
                {live.map((c) => (
                  <li key={`${c.model}|${c.variant}`} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {c.model} {c.variant}
                    </span>
                    <span className="num" style={{ color: c.available >= c.requested ? "var(--positive)" : "var(--negative)" }}>
                      {c.available} free of {c.requested} needed
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                No line detail on this order.
              </p>
            )}
            {(reserved.length > 0 || shipped.length > 0) && (
              <p className="mt-3 flex flex-wrap gap-1.5">
                {[...reserved, ...shipped].map((u) => (
                  <Link key={u.id} href={`/dms/inventory/vehicles?q=${u.vin}`} className="rounded-[6px] px-1.5 py-0.5 font-mono text-[11px] hover:underline" style={{ background: "var(--surface-subtle)" }}>
                    {u.vin} · {u.status}
                  </Link>
                ))}
              </p>
            )}
            {(backOrder || parent) && (
              <p className="mt-3 text-[12.5px]">
                {backOrder && (
                  <>
                    The rest was back-ordered as{" "}
                    <Link href={`/dms/orders/${backOrder.id}`} className="underline">
                      {backOrder.orderNo}
                    </Link>{" "}
                    ({backOrder.status}).
                  </>
                )}
                {parent && (
                  <>
                    Back-order of{" "}
                    <Link href={`/dms/orders/${parent.id}`} className="underline">
                      {parent.orderNo}
                    </Link>
                    .
                  </>
                )}
              </p>
            )}
            {order.notice && (
              <p className="mt-3 text-[12px]" style={{ color: "var(--fg-muted)" }}>
                Out-of-stock notice sent {fullDate(order.notice.sentAt)}
                {order.notice.expectedRestock ? ` · restock expected ${formatDate(order.notice.expectedRestock)}` : ""}
                {order.notice.offeredUnits ? ` · ${order.notice.offeredUnits} offered now` : ""}
                {order.notice.message ? ` · ${order.notice.message}` : ""}
              </p>
            )}
            {short && (
              <div className="mt-4 space-y-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={recheckStock.bind(null, order.id)}>
                    <SubmitButton size="sm">Re-check stock</SubmitButton>
                  </ActionForm>
                  {live.some((c) => c.available > 0) && (
                    <ActionForm action={shipAvailable.bind(null, order.id)}>
                      <SubmitButton size="sm" tone="ghost">
                        Ship what&apos;s in stock, back-order the rest
                      </SubmitButton>
                    </ActionForm>
                  )}
                </div>
                <ActionForm action={sendStockNotice.bind(null, order.id)} className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <div>
                    <label className="field-label" htmlFor="sn-date">
                      Expected restock
                    </label>
                    <input id="sn-date" name="expectedRestock" type="date" className="field" />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="sn-msg">
                      Message to the dealer
                    </label>
                    <input id="sn-msg" name="message" maxLength={300} className="field" placeholder="e.g. Next batch leaves the line on the 20th" />
                  </div>
                  <label className="flex items-center gap-2 text-[12.5px] sm:col-span-2">
                    <input type="checkbox" name="offer" className="h-4 w-4" /> Offer what is in stock now as a part delivery
                  </label>
                  <div className="sm:col-span-2">
                    <SubmitButton size="sm" tone="ghost">
                      Send out-of-stock notice
                    </SubmitButton>
                  </div>
                </ActionForm>
              </div>
            )}
          </Panel>

          <Panel title="History" description="Every step, newest first.">
            {history.length ? (
              <ol className="relative space-y-4 pl-5" style={{ borderLeft: "1px solid var(--border)" }}>
                {history.map((e, i) => (
                  <li key={i} className="relative">
                    <span
                      className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full"
                      style={{ background: e.status === "Cancelled" ? "var(--negative)" : i === 0 ? "var(--brand)" : "var(--border-strong)", boxShadow: "0 0 0 3px var(--card)" }}
                    />
                    <p className="text-[13px] font-medium">{e.status}</p>
                    <p className="text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                      {fullDate(e.at)} · {e.by}
                    </p>
                    {e.note && <p className="mt-1 text-[12px]">{e.note}</p>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>
                No history was recorded for this order.
              </p>
            )}
          </Panel>
        </div>

        <div className="grid min-w-0 gap-4">
          <Panel title="Summary">
            <dl className="space-y-2 text-[12.5px]">
              <Row label="Order value" value={formatINR(order.value)} />
              <Row label="GST (5%)" value={formatINR(gst)} />
              <div className="flex items-baseline justify-between gap-3 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                <dt className="font-semibold">Total</dt>
                <dd className="num text-[16px] font-bold">{formatINR(order.value + gst)}</dd>
              </div>
            </dl>
            <MetricTiles
              className="mt-3"
              items={[
                { label: "Units", value: order.units },
                { label: "Per unit", value: formatINR(order.value / Math.max(1, order.units)) },
              ]}
            />
          </Panel>

          <Panel
            title="Billing"
            description={invoice ? "Raised when the order was dispatched." : "The invoice is raised when the order is dispatched."}
            action={invoice ? { href: `/dms/orders/invoices/${invoice.id}`, label: "Open the invoice" } : undefined}
          >
            {invoice ? (
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-medium">{invoice.invoiceNo}</span>
                  <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                    {formatINR(invoice.amount)} · due {formatDate(invoice.dueOn)}
                  </span>
                </span>
                <StatusPill value={invoiceState(invoice)} />
              </div>
            ) : (
              <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                {cancelled ? "Cancelled before dispatch — nothing was billed." : "Nothing billed yet."}
              </p>
            )}
          </Panel>

          <Panel title="Dealer" action={dealer ? { href: `/dms/dealers?q=${encodeURIComponent(dealer.name)}`, label: "Open in Dealer 360" } : undefined}>
            {dealer ? (
              <dl className="space-y-2 text-[12.5px]">
                <Row label="Dealer" value={dealer.name} />
                <Row label="Code" value={dealer.code} />
                <Row label="City" value={`${dealer.city}, ${dealer.state}`} />
                <Row label="Tier" value={dealer.tier} />
                <Row label="Outstanding" value={formatINR(dealer.outstanding)} />
                <div className="flex items-center justify-between gap-3">
                  <dt style={{ color: "var(--fg-muted)" }}>Status</dt>
                  <dd>
                    <StatusPill value={dealer.status} />
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                {order.dealer} is no longer in the dealer network.
              </p>
            )}
          </Panel>

          {CANCELLABLE.includes(order.status) && (
            <details className="disclosure surface">
              <summary className="flex items-center gap-2 px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--negative)" }}>
                <TriangleAlert className="h-4 w-4" />
                Cancel this order…
              </summary>
              <ActionForm action={cancelOrder.bind(null, order.id)} className="space-y-2.5 px-4 pb-4">
                <label className="field-label" htmlFor="cancel-reason">
                  Reason (shown in the order history)
                </label>
                <textarea id="cancel-reason" name="reason" required minLength={3} maxLength={300} rows={3} className="field" placeholder="e.g. Dealer revised the model mix" />
                <SubmitButton size="sm" tone="danger">
                  Cancel order
                </SubmitButton>
              </ActionForm>
            </details>
          )}

          {order.history?.length ? (
            <p className="text-center text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
              Last change {relativeTime(order.history[order.history.length - 1].at)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt style={{ color: "var(--fg-muted)" }}>{label}</dt>
      <dd className="num text-right font-medium">{value}</dd>
    </div>
  );
}
