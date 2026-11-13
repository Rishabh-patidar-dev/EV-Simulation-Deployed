import Link from "next/link";
import { orderTabs } from "@/components/orders/tabs";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import { Panel } from "@/components/ui/cards";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, formatDate } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/workflow";
import { bestFit, checkLines, freeOemStock, lineKey, shortfall } from "@/lib/stock";
import { recheckStock, shipAvailable } from "@/server/actions/orders";
import { readMany } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * Short of stock — EV-CRM's Close Orders: every dealer order OEM stock could
 * not cover, grouped by the model and variant they are competing for, each
 * pool ranked "best fit" against live stock (least short first, then the
 * larger order) so the desk fills the order closest to complete. Re-check,
 * ship what is there, or open the order to send the out-of-stock notice.
 */
export default async function ShortOrdersPage() {
  const { data } = await readMany(["orders", "vehicle_units", "dealers"] as const);
  const stock = freeOemStock(data.vehicle_units, data.dealers);
  const short = data.orders.filter((o) => o.status === "Stock Short").map((order) => ({ order, checks: checkLines(order, stock) }));

  // One pool per model and variant that some short order is waiting for.
  const pools = new Map<string, { model: string; variant: string; free: number; rows: typeof short }>();
  for (const row of short) {
    for (const c of row.checks) {
      if (c.available >= c.requested) continue;
      const key = lineKey(c);
      const pool = pools.get(key) ?? { model: c.model, variant: c.variant, free: stock.get(key)?.length ?? 0, rows: [] };
      pool.rows.push(row);
      pools.set(key, pool);
    }
  }
  const ordered = [...pools.values()].sort((a, b) => b.rows.length - a.rows.length);
  const unitsShort = short.reduce((s, r) => s + shortfall(r.checks), 0);
  const fillable = short.filter((r) => r.checks.every((c) => c.available >= c.requested));
  const noticed = short.filter((r) => r.order.notice);

  return (
    <ModuleScreen
      href="/dms/orders"
      exportCollection="orders"
      tabs={<Tabs current="/dms/orders/short" tabs={orderTabs({ orders: data.orders.length, short: short.length })} />}
      stats={[
        { label: "Short orders", value: String(short.length), hint: `${unitsShort} units short against live stock`, tone: short.length ? "warning" : "neutral" },
        { label: "Fillable now", value: String(fillable.length), hint: "Stock has come in — re-check them", tone: fillable.length ? "positive" : "neutral" },
        { label: "Notice sent", value: `${noticed.length} of ${short.length}`, hint: "Dealers told what is short and when" },
        { label: "Models short", value: String(pools.size), hint: "Pools orders are competing for" },
      ]}
    >
      {short.length === 0 ? (
        <p className="px-5 py-10 text-center text-[13px]" style={{ color: "var(--fg-muted)" }}>
          Nothing is short — every order checked against OEM stock was covered.
        </p>
      ) : (
        <div className="grid gap-4 p-4">
          {ordered.map((pool) => {
            const ranked = bestFit(pool.rows);
            return (
              <Panel
                key={`${pool.model}|${pool.variant}`}
                title={`${pool.model} ${pool.variant}`}
                description={`${pool.free} free in OEM stock · ${ranked.length} order${ranked.length === 1 ? "" : "s"} waiting — best fit first`}
                bodyClassName="p-0!"
              >
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th className="text-right">Units</th>
                        <th className="text-right">Short</th>
                        <th>Notice</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {ranked.map(({ order, checks }, i) => {
                        const fits = checks.every((c) => c.available >= c.requested);
                        const some = checks.some((c) => c.available > 0);
                        return (
                          <tr key={order.id}>
                            <td>
                              <Link href={`/dms/orders/${order.id}`} className="font-medium hover:underline" style={{ color: "var(--brand-ink)" }}>
                                {order.orderNo}
                              </Link>
                              {i === 0 && ranked.length > 1 && (
                                <span className="ml-1.5">
                                  <Pill tone="positive">Best fit</Pill>
                                </span>
                              )}
                              {order.backOrderOf && (
                                <span className="ml-1.5">
                                  <Pill tone="info">Back-order</Pill>
                                </span>
                              )}
                              <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                                {order.dealer} · placed {formatDate(order.placedAt)}
                              </span>
                            </td>
                            <td className="num text-right">{order.units}</td>
                            <td className="num text-right" style={{ color: fits ? "var(--positive)" : "var(--negative)" }}>
                              {fits ? "covered now" : shortfall(checks)}
                            </td>
                            <td className="text-[12px]">
                              {order.notice ? (
                                <>
                                  Sent {formatDate(order.notice.sentAt)}
                                  {order.notice.expectedRestock ? ` · restock ${formatDate(order.notice.expectedRestock)}` : ""}
                                </>
                              ) : (
                                <Link href={`/dms/orders/${order.id}`} className="underline" style={{ color: "var(--warning)" }}>
                                  Not sent
                                </Link>
                              )}
                            </td>
                            <td>
                              <span className="flex flex-wrap justify-end gap-1.5">
                                <ActionForm action={recheckStock.bind(null, order.id)}>
                                  <SubmitButton size="sm" tone={fits ? "primary" : "ghost"}>
                                    Re-check
                                  </SubmitButton>
                                </ActionForm>
                                {!fits && some && (
                                  <ActionForm action={shipAvailable.bind(null, order.id)}>
                                    <SubmitButton size="sm" tone="ghost">
                                      Ship part
                                    </SubmitButton>
                                  </ActionForm>
                                )}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            );
          })}
          {fillable.length > 0 && (
            <Panel title="Covered now" description="Stock has come in since these were checked — re-check to confirm and reserve.">
              <ul className="space-y-1.5 text-[12.5px]">
                {fillable.map(({ order }) => (
                  <li key={order.id} className="flex items-center justify-between gap-2">
                    <Link href={`/dms/orders/${order.id}`} className="underline">
                      {order.orderNo} · {order.dealer}
                    </Link>
                    <ActionForm action={recheckStock.bind(null, order.id)}>
                      <SubmitButton size="sm">Confirm</SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </ModuleScreen>
  );
}
