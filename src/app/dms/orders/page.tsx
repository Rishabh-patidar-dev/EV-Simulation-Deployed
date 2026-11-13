import Link from "next/link";
import OrderLinesEditor from "@/components/orders/OrderLinesEditor";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, Pill, StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { isLate } from "@/lib/orders";
import { orderDeskStats } from "@/lib/stock";
import { Tabs } from "@/components/ui/workflow";
import { orderTabs } from "@/components/orders/tabs";
import { MagnitudeBars } from "@/components/ui/cards";
import { filterRows } from "@/lib/search";
import { VEHICLE_MODELS } from "@/lib/vehicles";
import { placeOrder } from "@/server/actions/orders";
import { readMany } from "@/server/store";
import { ORDER_FLOW, type Order } from "@/server/types";

export const dynamic = "force-dynamic";

const STATUSES: Array<Order["status"]> = ["Placed", "Stock Short", "Acknowledged", "In Production", "Dispatched", "Received", "Cancelled"];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const COLUMNS: Column<Order>[] = [
  {
    key: "no",
    header: "Order",
    render: (o) => (
      <Link href={`/dms/orders/${o.id}`} className="block hover:underline">
        <span className="block font-medium" style={{ color: "var(--brand-ink)" }}>
          {o.orderNo}
        </span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {o.dealer}
        </span>
      </Link>
    ),
  },
  {
    key: "lines",
    header: "Lines",
    secondary: true,
    render: (o) =>
      o.lines?.length ? (
        <span className="block max-w-[13rem] truncate" title={o.lines.map((l) => `${l.quantity} × ${l.model}`).join(", ")}>
          {o.lines.map((l) => `${l.quantity} × ${l.model}`).join(", ")}
        </span>
      ) : (
        `${o.lineItems} line${o.lineItems === 1 ? "" : "s"}`
      ),
  },
  { key: "units", header: "Units", align: "right", render: (o) => o.units },
  { key: "value", header: "Value", align: "right", render: (o) => <span className="whitespace-nowrap">{formatINR(o.value)}</span> },
  {
    key: "status",
    header: "Status",
    render: (o) => (
      <span className="flex flex-wrap items-center gap-1">
        <StatusPill value={o.status} />
        {isLate(o) && <Pill tone="negative">Late</Pill>}
        {o.creditHold && <Pill tone="warning">Credit hold</Pill>}
      </span>
    ),
  },
  {
    key: "eta",
    header: "Expected",
    align: "right",
    render: (o) => (
      <span className="block whitespace-nowrap">
        <span className="block">{formatDate(o.expectedBy)}</span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
          placed {formatDate(o.placedAt)}
        </span>
      </span>
    ),
  },
];

/**
 * Order management — the order journey the client described as "how orders
 * are placed in our DMS and received in ERP", end to end on one screen: place
 * an order, move it along, open any order for its lines and history.
 */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const statusParam = one(raw.status);
  const status = (STATUSES as string[]).includes(statusParam) ? (statusParam as Order["status"]) : undefined;
  const lateOnly = one(raw.late) === "1";

  const { data } = await readMany(["orders", "dealers", "vehicle_units"] as const);
  const rows = data.orders;

  const shown = filterRows(rows, q).filter((o) => (!status || o.status === status) && (!lateOnly || isLate(o)));
  const open = rows.filter((o) => o.status !== "Received" && o.status !== "Cancelled");
  const late = open.filter((o) => isLate(o));
  const awaiting = rows.filter((o) => o.status === "Placed");
  const short = rows.filter((o) => o.status === "Stock Short");
  const desk = orderDeskStats(rows, data.dealers);

  // List price per model: the average of what that model is priced at in stock.
  const listPrices: Record<string, number> = {};
  for (const model of VEHICLE_MODELS) {
    const units = data.vehicle_units.filter((u) => u.model === model);
    if (units.length) listPrices[model] = Math.round(units.reduce((s, u) => s + u.price, 0) / units.length / 500) * 500;
  }
  const dealers = data.dealers.filter((d) => d.status !== "Suspended").map((d) => d.name).sort();

  const chipHref = (next: Order["status"] | undefined) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (next) params.set("status", next);
    const query = params.toString();
    return query ? `/dms/orders?${query}` : "/dms/orders";
  };

  return (
    <ModuleScreen
      href="/dms/orders"
      exportCollection="orders"
      searchPlaceholder="Search orders or dealers"
      stats={[
        { label: "Open orders", value: String(open.length), hint: `${rows.length} in total` },
        { label: "Open commitment", value: formatINR(open.reduce((s, o) => s + o.value, 0)), hint: `${open.reduce((s, o) => s + o.units, 0)} units not yet received` },
        { label: "To stock-check", value: String(awaiting.length), hint: `${short.length} short of stock`, tone: short.length ? "warning" : awaiting.length ? "info" : "neutral" },
        {
          label: "Late",
          value: String(late.length),
          hint: `Open orders average ${desk.avgOpenDays} days${desk.fulfilment !== null ? ` · ${desk.fulfilment}% fulfilled` : ""}`,
          tone: late.length ? "negative" : "neutral",
        },
      ]}
      tabs={<Tabs current="/dms/orders" tabs={orderTabs({ orders: rows.length, short: short.length })} />}
      toolbar={
        <Disclosure label="Place an order" open={one(raw.new) === "1"}>
          <ActionForm action={placeOrder} resetOnSuccess className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="field-label" htmlFor="order-dealer">
                  Dealer
                </label>
                <select id="order-dealer" name="dealer" required className="field" defaultValue="">
                  <option value="" disabled>
                    Choose a dealer
                  </option>
                  {dealers.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="order-expected">
                  Expected by (optional)
                </label>
                <input id="order-expected" name="expectedBy" type="date" className="field" />
              </div>
              <p className="self-end text-[11.5px] leading-snug" style={{ color: "var(--fg-muted)" }}>
                Prices start at each model&apos;s average price in stock. Left blank, the expected date is three weeks out.
              </p>
            </div>
            <OrderLinesEditor models={[...VEHICLE_MODELS]} listPrices={listPrices} />
            <SubmitButton>Place order</SubmitButton>
          </ActionForm>
        </Disclosure>
      }
      aside={
        <>
          <Card>
            <CardHeader title="Fulfilment funnel" subtitle="Orders at each step — select one to filter" />
            <ul className="space-y-1 px-3 pb-4 pt-1">
              {ORDER_FLOW.map((step, i) => {
                const count = rows.filter((o) => o.status === step).length;
                const peak = Math.max(1, ...ORDER_FLOW.map((s) => rows.filter((o) => o.status === s).length));
                return (
                  <li key={step}>
                    <Link
                      href={chipHref(status === step ? undefined : step)}
                      className="block rounded-[10px] px-2.5 py-1.5 transition-colors hover:bg-[color:var(--hover)]"
                      style={status === step ? { background: "var(--brand-soft)" } : undefined}
                    >
                      <span className="mb-1 flex items-baseline justify-between">
                        <span className="text-[12.5px]">{step}</span>
                        <span className="num text-[12.5px] font-semibold">{count}</span>
                      </span>
                      <span className="block h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--bg)" }}>
                        <span className="block h-full rounded-full" style={{ width: `${(count / peak) * 100}%`, background: `var(--viz-${(i % 6) + 1})` }} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Demand by zone" subtitle="Units ordered by dealer state, with the most-ordered model" />
            <div className="px-5 pb-5 pt-1">
              {desk.zones.length ? (
                <MagnitudeBars data={desk.zones.slice(0, 6).map((z) => ({ key: z.zone, label: z.zone, meta: z.topModel, value: z.units, display: `${z.units} units` }))} />
              ) : (
                <p className="py-3 text-center text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                  No orders yet.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Orders per week" subtitle="Placed in each of the last eight weeks" />
            <div className="flex h-28 items-end gap-1.5 px-5 pb-5 pt-2">
              {desk.weekly.map((w) => {
                const peak = Math.max(1, ...desk.weekly.map((x) => x.value));
                return (
                  <div key={w.label} className="flex flex-1 flex-col items-center gap-1" title={`${w.value} orders, week of ${w.label}`}>
                    <span className="num text-[10.5px]" style={{ color: "var(--fg-muted)" }}>
                      {w.value || ""}
                    </span>
                    <span className="w-full rounded-t-[3px]" style={{ height: `${(w.value / peak) * 64 + 2}px`, background: "var(--brand)" }} />
                    <span className="text-[9.5px]" style={{ color: "var(--fg-faint)" }}>
                      {w.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHeader title="Running late" subtitle="Past the expected date, oldest first" />
            <ul className="space-y-2.5 px-5 pb-5 pt-1">
              {[...late]
                .sort((a, b) => +new Date(a.expectedBy) - +new Date(b.expectedBy))
                .slice(0, 6)
                .map((o) => (
                  <li key={o.id} className="flex items-baseline justify-between gap-3">
                    <Link href={`/dms/orders/${o.id}`} className="min-w-0 hover:underline">
                      <span className="block truncate text-[12.5px] font-medium">{o.orderNo}</span>
                      <span className="block truncate text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                        {o.dealer} · {o.status}
                      </span>
                    </Link>
                    <span className="shrink-0 text-[11.5px]" style={{ color: "var(--negative)" }}>
                      due {formatDate(o.expectedBy)}
                    </span>
                  </li>
                ))}
              {late.length === 0 && (
                <li className="py-3 text-center text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                  Every open order is on schedule.
                </li>
              )}
              {late.length > 6 && (
                <li>
                  <Link href="/dms/orders?late=1" className="text-[12px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                    All {late.length} late orders
                  </Link>
                </li>
              )}
            </ul>
          </Card>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
        {([undefined, ...STATUSES] as const).map((s) => {
          const selected = status === s && !lateOnly;
          return (
            <Link
              key={s ?? "all"}
              href={chipHref(s)}
              aria-current={selected ? "true" : undefined}
              className="rounded-full px-3 py-1 text-[12px] font-medium transition-colors"
              style={
                selected
                  ? { background: "var(--brand-soft)", color: "var(--brand-ink)", border: "1px solid color-mix(in srgb, var(--brand) 35%, transparent)" }
                  : { border: "1px solid var(--border)", color: "var(--fg-muted)" }
              }
            >
              {s ?? "All"} <span className="num opacity-70">{s ? rows.filter((o) => o.status === s).length : rows.length}</span>
            </Link>
          );
        })}
        {lateOnly && (
          <Link
            href={chipHref(status)}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium"
            style={{ background: "var(--negative-surface)", color: "var(--negative)", border: "1px solid var(--negative-border)" }}
          >
            Late only ✕
          </Link>
        )}
      </div>

      <DataTable rows={shown} columns={COLUMNS} empty={q || status || lateOnly ? "No order matches those filters." : "No orders yet — place the first one above."} />
    </ModuleScreen>
  );
}
