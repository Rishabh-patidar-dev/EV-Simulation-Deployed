import ModuleScreen from "@/components/shell/ModuleScreen";
import DonutChart from "@/components/charts/DonutChart";
import Link from "next/link";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, StatusPill, formatINR } from "@/components/ui/primitives";
import { filterRows, readQuery } from "@/lib/search";
import { receiveFromProduction, transferVehicle } from "@/server/actions/inventory";
import Disclosure from "@/components/ui/Disclosure";
import { Hint } from "@/components/ui/workflow";
import { PLANT, isOemStock } from "@/lib/stock";
import { VEHICLE_MODELS } from "@/lib/vehicles";
import { ORDER_VARIANTS } from "@/server/types";
import { readMany } from "@/server/store";
import type { VehicleUnit } from "@/server/types";

export const dynamic = "force-dynamic";

const COLUMNS: Column<VehicleUnit>[] = [
  {
    key: "vin",
    header: "VIN",
    render: (v) => (
      <span className="block">
        <span className="num block font-medium">{v.vin}</span>
        {v.registrationNo && (
          <span className="num block text-[11.5px]" style={{ color: "var(--positive)" }}>
            {v.registrationNo}
          </span>
        )}
      </span>
    ),
  },
  {
    key: "model",
    header: "Model",
    render: (v) => (
      <span className="block">
        <span className="block">{v.model}</span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {v.variant}
        </span>
      </span>
    ),
  },
  { key: "location", header: "Location", render: (v) => v.location, secondary: true },
  { key: "status", header: "Status", render: (v) => <StatusPill value={v.status} /> },
  {
    key: "ageing",
    header: "Ageing",
    align: "right",
    render: (v) => <span style={v.ageingDays > 90 ? { color: "var(--negative)" } : undefined}>{v.ageingDays}d</span>,
  },
  { key: "price", header: "Value", align: "right", render: (v) => formatINR(v.price) },
];

export default async function VehicleStockPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ data }, q] = await Promise.all([readMany(["vehicle_units", "bookings", "dealers", "orders"] as const), readQuery(searchParams)]);
  const dealerNames = new Set(data.dealers.map((d) => d.name));
  const rows = data.vehicle_units;
  const shown = filterRows(rows, q);
  const locations = [...new Set(rows.map((v) => v.location))].sort();
  const columns: Column<VehicleUnit>[] = [
    ...COLUMNS,
    {
      key: "act",
      header: "",
      align: "right",
      render: (v) => {
        const booking = v.bookingId ? data.bookings.find((b) => b.id === v.bookingId) : undefined;
        if (booking) {
          return (
            <Link href={`/crm/bookings?q=${encodeURIComponent(booking.bookingNo)}`} className="text-[12px] underline">
              {booking.bookingNo}
            </Link>
          );
        }
        const order = v.orderId && v.status === "Allocated" ? data.orders.find((o) => o.id === v.orderId) : undefined;
        if (order) {
          return (
            <Link href={`/dms/orders/${order.id}`} className="text-[12px] underline">
              Reserved · {order.orderNo}
            </Link>
          );
        }
        if (v.status !== "In Stock") return null;
        return (
          <details className="relative">
            <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: "var(--brand-ink)" }}>
              Transfer…
            </summary>
            <ActionForm action={transferVehicle.bind(null, v.id)} className="surface absolute right-0 z-10 mt-1 w-60 space-y-2 rounded-[10px] p-3 text-left">
              <input name="location" required list="stock-locations" maxLength={80} className="field" placeholder="To location" aria-label="Destination" />
              <SubmitButton size="sm">Move</SubmitButton>
            </ActionForm>
          </details>
        );
      },
    },
  ];

  const inStock = rows.filter((v) => v.status === "In Stock");
  const oem = inStock.filter((v) => isOemStock(v, dealerNames));
  const reserved = rows.filter((v) => v.status === "Allocated" && v.orderId);
  const byLocation = [...new Set(rows.map((v) => v.location))].map((location) => ({
    label: location,
    value: rows.filter((v) => v.location === location && v.status === "In Stock").length,
  }));

  return (
    <ModuleScreen
      href="/dms/inventory/vehicles"
      exportCollection="vehicle_units"
      searchPlaceholder="Search by VIN or model"
      stats={[
        { label: "Units tracked", value: String(rows.length), hint: `${shown.length} shown` },
        { label: "OEM stock", value: String(oem.length), hint: `Free to promise to dealer orders · ${reserved.length} reserved` },
        { label: "At dealers", value: String(inStock.length - oem.length), hint: "In stock at a dealership" },
        { label: "Stock value", value: formatINR(inStock.reduce((s, v) => s + v.price, 0)), hint: "At dealer price" },
        { label: "Ageing over 90 days", value: String(inStock.filter((v) => v.ageingDays > 90).length), hint: "Push these first", tone: inStock.some((v) => v.ageingDays > 90) ? "warning" : "neutral" },
      ]}
      toolbar={
        <Disclosure label="Receive from production">
          <ActionForm action={receiveFromProduction} resetOnSuccess className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="field-label" htmlFor="pr-model">
                  Model
                </label>
                <select id="pr-model" name="model" required className="field" defaultValue="">
                  <option value="" disabled>
                    Choose a model
                  </option>
                  {VEHICLE_MODELS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="pr-variant">
                  Variant
                </label>
                <select id="pr-variant" name="variant" className="field" defaultValue="Standard">
                  {ORDER_VARIANTS.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="pr-qty">
                  Quantity
                </label>
                <input id="pr-qty" name="quantity" type="number" min={1} max={500} defaultValue={10} required className="field" />
              </div>
              <div>
                <label className="field-label" htmlFor="pr-loc">
                  Into stock at
                </label>
                <input id="pr-loc" name="location" list="stock-locations" maxLength={80} defaultValue={PLANT} className="field" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton>Receive into OEM stock</SubmitButton>
              <Hint>Each vehicle gets its chassis number and a Production movement in the Inventory Logs. Dealer orders are confirmed from this stock.</Hint>
            </div>
          </ActionForm>
        </Disclosure>
      }
      aside={
        <Card>
          <CardHeader title="Stock by location" subtitle="Available units, not allocated" />
          <div className="px-5 pb-6 pt-1">
            <DonutChart data={byLocation} centerLabel="In stock" />
          </div>
        </Card>
      }
    >
      <datalist id="stock-locations">
        {locations.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <DataTable rows={shown} columns={columns} empty="No vehicles match that search." maxHeight={620} />
    </ModuleScreen>
  );
}
