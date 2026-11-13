import Link from "next/link";
import { partTabs } from "@/components/parts/tabs";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { FilterChips, Hint, Tabs, withParams } from "@/components/ui/workflow";
import { filterRows } from "@/lib/search";
import { placePartOrder } from "@/server/actions/partOrders";
import { readMany } from "@/server/store";
import type { PartOrder } from "@/server/types";

export const dynamic = "force-dynamic";

const STATUSES: Array<PartOrder["status"]> = ["Requested", "Short", "Confirmed", "Dispatched", "Delivered", "Cancelled"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const COLUMNS: Column<PartOrder>[] = [
  {
    key: "no",
    header: "Order",
    render: (o) => (
      <Link href={`/dms/inventory/spare-parts/orders/${o.id}`} className="block hover:underline">
        <span className="block font-medium" style={{ color: "var(--brand-ink)" }}>
          {o.orderNo}
        </span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {o.dealer} · {formatDate(o.placedAt)}
        </span>
      </Link>
    ),
  },
  {
    key: "lines",
    header: "Parts",
    secondary: true,
    render: (o) => (
      <span className="block max-w-[16rem] truncate" title={o.lines.map((l) => `${l.quantity} × ${l.name}`).join(", ")}>
        {o.lines.map((l) => `${l.quantity} × ${l.sku}`).join(", ")}
      </span>
    ),
  },
  { key: "value", header: "Value", align: "right", render: (o) => formatINR(o.value) },
  {
    key: "status",
    header: "Status",
    render: (o) => (
      <span className="flex flex-wrap items-center gap-1">
        <StatusPill value={o.status} />
        {o.backOrderOf && <Pill tone="info">Back-order</Pill>}
        {o.status === "Short" && !o.notice && <Pill tone="warning">No notice</Pill>}
      </span>
    ),
  },
];

/**
 * Dealer spare-part orders — EV-CRM's spare-part requests, worked like the
 * vehicle order desk: check against parts stock, confirm and pick, or hold as
 * short with a notice; dispatch with an 18% GST invoice; deliver.
 */
export default async function PartOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const statusParam = one(raw.status);
  const status = (STATUSES as string[]).includes(statusParam) ? (statusParam as PartOrder["status"]) : undefined;
  const { data } = await readMany(["part_orders", "spare_parts", "dealers"] as const);
  const rows = data.part_orders;
  const shown = filterRows(rows, q).filter((o) => !status || o.status === status);
  const open = rows.filter((o) => o.status !== "Delivered" && o.status !== "Cancelled");
  const dealers = data.dealers.filter((d) => d.status !== "Suspended").map((d) => d.name).sort();
  const parts = [...data.spare_parts].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <ModuleScreen
      href="/dms/inventory/spare-parts"
      exportCollection="part_orders"
      searchPlaceholder="Search orders, dealers or SKUs"
      tabs={<Tabs current="/dms/inventory/spare-parts/orders" tabs={partTabs({ parts: data.spare_parts.length, orders: rows.length })} />}
      stats={[
        { label: "Open orders", value: String(open.length), hint: formatINR(open.reduce((s, o) => s + o.value, 0)) + " before GST" },
        { label: "To check", value: String(rows.filter((o) => o.status === "Requested").length), hint: "Against parts stock" },
        { label: "Short", value: String(rows.filter((o) => o.status === "Short").length), hint: "Waiting on stock", tone: rows.some((o) => o.status === "Short") ? "warning" : "neutral" },
        { label: "Ready to dispatch", value: String(rows.filter((o) => o.status === "Confirmed").length), hint: "Picked from stock" },
      ]}
      toolbar={
        <Disclosure label="Place a dealer parts order" open={one(raw.new) === "1"}>
          <ActionForm action={placePartOrder} resetOnSuccess className="space-y-3">
            <div className="max-w-sm">
              <label className="field-label" htmlFor="po-dealer">
                Dealer
              </label>
              <select id="po-dealer" name="dealer" required className="field" defaultValue="">
                <option value="" disabled>
                  Choose a dealer
                </option>
                {dealers.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                  <select name="partId" className="field" defaultValue="" aria-label={`Part ${i + 1}`} required={i === 0}>
                    <option value="">{i === 0 ? "Choose a part" : "Another part (optional)"}</option>
                    {parts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} · {p.name} · {p.onHand} on hand · {formatINR(p.unitPrice)}
                      </option>
                    ))}
                  </select>
                  <input name="quantity" type="number" min={1} max={10000} defaultValue={1} className="field" aria-label={`Quantity ${i + 1}`} />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton>Place order</SubmitButton>
              <Hint>Priced at the catalogue price; 18% GST is added on the invoice at dispatch. Refused for a dealer on compliance hold or over its credit limit.</Hint>
            </div>
          </ActionForm>
        </Disclosure>
      }
    >
      <FilterChips options={STATUSES.map((s) => ({ value: s, count: rows.filter((o) => o.status === s).length }))} current={status} hrefFor={(s) => withParams("/dms/inventory/spare-parts/orders", { q, status: s })} total={rows.length} />
      <DataTable rows={shown} columns={COLUMNS} empty={q || status ? "No order matches those filters." : "No dealer parts orders yet — place the first one above."} />
    </ModuleScreen>
  );
}
