import Link from "next/link";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, Pill, StatusPill, formatDate } from "@/components/ui/primitives";
import { FilterChips, withParams } from "@/components/ui/workflow";
import { filterRows } from "@/lib/search";
import { daysSinceIso, daysUntilIso, isPast } from "@/lib/time";
import { openDeliveryForBooking } from "@/server/actions/delivery";
import { readMany } from "@/server/store";
import { DELIVERY_FLOW, PDI_CHECKS, type Delivery } from "@/server/types";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATUSES = [...DELIVERY_FLOW, "Cancelled"] as const;

const pdiPassed = (d: Delivery) => d.vehicles.filter((v) => v.pdiAt).length;

const COLUMNS: Column<Delivery>[] = [
  {
    key: "no",
    header: "Delivery",
    render: (d) => (
      <Link href={`/dms/orders/delivery/${d.id}`} className="block hover:underline">
        <span className="block font-medium" style={{ color: "var(--brand-ink)" }}>
          {d.deliveryNo}
        </span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {d.customer} · {d.bookingNo}
        </span>
      </Link>
    ),
  },
  { key: "vehicles", header: "Vehicles", render: (d) => `${d.quantity} × ${d.model}` },
  { key: "dealer", header: "Dealer", secondary: true, render: (d) => d.dealer },
  {
    key: "progress",
    header: "Allocated · PDI",
    align: "right",
    render: (d) => (
      <span className="num whitespace-nowrap" style={d.vehicles.length < d.quantity && d.status === "Scheduled" ? { color: "var(--warning)" } : undefined}>
        {d.vehicles.length}/{d.quantity} · {pdiPassed(d)}/{d.quantity}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (d) => (
      <span className="flex flex-wrap items-center gap-1">
        <StatusPill value={d.status} />
        {(d.status === "Scheduled" || d.status === "PDI Done") && isPast(d.scheduledFor) && <Pill tone="negative">Overdue</Pill>}
      </span>
    ),
  },
  {
    key: "when",
    header: "Scheduled",
    align: "right",
    render: (d) => <span className="whitespace-nowrap">{formatDate(d.handover?.at ?? d.scheduledFor)}</span>,
  },
];

/**
 * Vehicle delivery — every booking's handover: vehicles allocated off stock,
 * a PDI per chassis, insurance, gate pass and e-way bill, and the customer's
 * OTP at handover.
 */
export default async function DeliveryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const statusParam = one(raw.status);
  const status = (STATUSES as readonly string[]).includes(statusParam) ? (statusParam as Delivery["status"]) : undefined;

  const { data } = await readMany(["deliveries", "bookings", "vehicle_units"] as const);
  const rows = data.deliveries;
  const shown = filterRows(rows, q).filter((d) => !status || d.status === status);
  const open = rows.filter((d) => d.status !== "Handed Over" && d.status !== "Cancelled");
  const handed30 = rows.filter((d) => d.status === "Handed Over" && d.handover && daysSinceIso(d.handover.at) <= 30);
  const thisWeek = open.filter((d) => daysUntilIso(d.scheduledFor) <= 7);
  const shortOfStock = open.filter((d) => d.status === "Scheduled" && d.vehicles.length < d.quantity);

  // Bookings made ready before deliveries were tracked, or ready with no delivery open.
  const withDelivery = new Set(rows.filter((d) => d.status !== "Cancelled").map((d) => d.bookingId));
  const unscheduled = data.bookings.filter((b) => b.status === "Ready for Delivery" && !withDelivery.has(b.id));

  return (
    <ModuleScreen
      href="/dms/orders/delivery"
      exportCollection="deliveries"
      searchPlaceholder="Search deliveries, customers or bookings"
      stats={[
        { label: "Open deliveries", value: String(open.length), hint: `${thisWeek.length} due in the next 7 days` },
        { label: "Short of stock", value: String(shortOfStock.length), hint: "Vehicles still to allocate", tone: shortOfStock.length ? "warning" : "neutral" },
        { label: "Out for handover", value: String(rows.filter((d) => d.status === "Dispatched").length), hint: "OTP sent, awaiting the customer" },
        { label: "Handed over, 30 days", value: String(handed30.reduce((s, d) => s + d.vehicles.length, 0)), hint: `${handed30.length} deliveries` },
      ]}
      toolbar={
        unscheduled.length > 0 ? (
          <section className="surface overflow-hidden" aria-label="Ready bookings without a delivery">
            <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <h2 className="text-[14px] font-semibold">Ready for delivery, not yet scheduled</h2>
              <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
                Open a delivery to allocate the vehicles and start the PDI.
              </p>
            </header>
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {unscheduled.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5" style={{ borderColor: "var(--border)" }}>
                  <span className="min-w-0">
                    <span className="font-medium">{b.bookingNo}</span>
                    <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                      {b.customer} · {b.quantity ?? 1} × {b.model} · {b.dealer}
                    </span>
                  </span>
                  <ActionForm action={openDeliveryForBooking.bind(null, b.id)}>
                    <SubmitButton size="sm">Open delivery</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </section>
        ) : undefined
      }
      aside={
        <Card>
          <CardHeader title="Stock to allocate" subtitle="In stock, by model — for the deliveries short of vehicles" />
          <ul className="space-y-2 px-5 pb-5 pt-1">
            {[...new Set(shortOfStock.map((d) => d.model))].map((model) => {
              const inStock = data.vehicle_units.filter((u) => u.model === model && u.status === "In Stock").length;
              const needed = shortOfStock.filter((d) => d.model === model).reduce((s, d) => s + d.quantity - d.vehicles.length, 0);
              return (
                <li key={model} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="min-w-0 truncate">{model}</span>
                  <span className="shrink-0 whitespace-nowrap" style={{ color: inStock < needed ? "var(--negative)" : "var(--fg-muted)" }}>
                    {inStock} in stock · {needed} needed
                  </span>
                </li>
              );
            })}
            {shortOfStock.length === 0 && (
              <li className="py-3 text-center text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                Every open delivery has its vehicles.
              </li>
            )}
            {shortOfStock.length > 0 && (
              <li>
                <Link href="/dms/orders?new=1" className="text-[12px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                  Short? Place a dealer order
                </Link>
              </li>
            )}
          </ul>
          <p className="px-5 pb-4 text-[11px]" style={{ color: "var(--fg-faint)" }}>
            PDI: {PDI_CHECKS.length} checks per chassis.
          </p>
        </Card>
      }
    >
      <FilterChips
        total={rows.length}
        current={status}
        hrefFor={(value) => withParams("/dms/orders/delivery", { q, status: value })}
        options={STATUSES.map((s) => ({ value: s, count: rows.filter((d) => d.status === s).length }))}
      />
      <DataTable rows={shown} columns={COLUMNS} empty={q || status ? "No delivery matches those filters." : "No deliveries yet — they open when a booking is ready for delivery."} />
    </ModuleScreen>
  );
}
