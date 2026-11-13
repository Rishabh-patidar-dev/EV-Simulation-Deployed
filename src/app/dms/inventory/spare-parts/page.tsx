import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, formatINR } from "@/components/ui/primitives";
import { filterRows, readQuery } from "@/lib/search";
import { ADJUSTMENT_REASONS, PART_CATEGORIES } from "@/lib/inventory";
import { adjustPart, createSparePart, deleteSparePart, receiveParts, recordStockAdjustment } from "@/server/actions/inventory";
import { readMany } from "@/server/store";
import { Tabs } from "@/components/ui/workflow";
import { partTabs } from "@/components/parts/tabs";
import type { SparePart } from "@/server/types";

export const dynamic = "force-dynamic";

const COLUMNS: Column<SparePart>[] = [
  { key: "sku", header: "SKU", render: (p) => <span className="font-medium">{p.sku}</span> },
  { key: "name", header: "Part", render: (p) => p.name },
  { key: "category", header: "Category", render: (p) => <Pill tone="brand">{p.category}</Pill>, secondary: true },
  { key: "location", header: "Location", render: (p) => p.location, secondary: true },
  {
    key: "onHand",
    header: "On hand",
    align: "right",
    render: (p) => (
      <span style={p.onHand < p.reorderLevel ? { color: "var(--negative)", fontWeight: 600 } : undefined}>{p.onHand}</span>
    ),
  },
  { key: "reorder", header: "Reorder at", align: "right", render: (p) => p.reorderLevel, secondary: true },
  { key: "unit", header: "Unit price", align: "right", render: (p) => formatINR(p.unitPrice), secondary: true },
  { key: "value", header: "Stock value", align: "right", render: (p) => formatINR(p.onHand * p.unitPrice) },
  {
    key: "act",
    header: "",
    align: "right",
    render: (p) => (
      <details className="relative">
        <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: "var(--brand-ink)" }}>
          {p.onHand < p.reorderLevel ? "Receive…" : "Stock…"}
        </summary>
        <div className="surface absolute right-0 z-10 mt-1 w-72 space-y-3 rounded-[10px] p-3 text-left">
          <ActionForm action={receiveParts.bind(null, p.id)} resetOnSuccess className="space-y-2">
            <p className="field-label">Receive against a purchase</p>
            <div className="flex gap-2">
              <input name="quantity" type="number" min={1} required defaultValue={Math.max(1, p.reorderLevel * 2 - p.onHand)} className="field w-24!" aria-label="Quantity received" />
              <input name="reference" maxLength={40} className="field" placeholder="GRN / invoice no." aria-label="Reference" />
            </div>
            <SubmitButton size="sm">Receive</SubmitButton>
          </ActionForm>
          <ActionForm action={adjustPart.bind(null, p.id)} className="space-y-2 pt-2">
            <p className="field-label">Part, reorder level and price</p>
            <input name="name" defaultValue={p.name} required maxLength={80} className="field" aria-label="Part name" />
            <div className="flex gap-2">
              <select name="category" defaultValue={p.category} className="field" aria-label="Category">
                {PART_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input name="location" defaultValue={p.location} maxLength={60} className="field" aria-label="Location" />
            </div>
            <div className="flex gap-2">
              <input name="reorderLevel" type="number" min={0} defaultValue={p.reorderLevel} className="field" aria-label="Reorder level" />
              <input name="unitPrice" type="number" min={1} defaultValue={p.unitPrice} className="field" aria-label="Unit price" />
            </div>
            <SubmitButton size="sm" tone="ghost">
              Save
            </SubmitButton>
          </ActionForm>
          <ActionForm action={recordStockAdjustment.bind(null, p.id)} className="space-y-2 pt-2">
            <p className="field-label">Physical count or write-off</p>
            <div className="flex gap-2">
              <input name="counted" type="number" min={0} step={1} required defaultValue={p.onHand} className="field w-24!" aria-label={`Counted quantity for ${p.sku}`} />
              <select name="reason" defaultValue={ADJUSTMENT_REASONS[0]} className="field" aria-label="Reason">
                {ADJUSTMENT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <input name="note" maxLength={40} className="field" placeholder="Count sheet or claim no." aria-label="Count reference" />
            <SubmitButton size="sm" tone="ghost">
              Record count
            </SubmitButton>
          </ActionForm>
          {/* Nothing on the shelf and nothing issued — otherwise the action refuses. */}
          {p.onHand === 0 && (
            <details className="pt-2" style={{ borderTop: "1px solid var(--border)" }}>
              <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: "var(--negative)" }}>
                Remove this part…
              </summary>
              <ActionForm action={deleteSparePart.bind(null, p.id)} className="space-y-2 pt-2">
                <p className="text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                  {p.sku} leaves the catalogue. A part that has been issued to a job card is kept.
                </p>
                <SubmitButton size="sm" tone="danger">
                  Yes, remove {p.sku}
                </SubmitButton>
              </ActionForm>
            </details>
          )}
        </div>
      </details>
    ),
  },
];

export default async function SparePartsPage({ searchParams }: { searchParams: Promise<{ q?: string; new?: string }> }) {
  const [{ data }, q, params] = await Promise.all([readMany(["spare_parts", "part_orders"] as const), readQuery(searchParams), searchParams]);
  const rows = data.spare_parts;

  // Below-reorder lines first — the only rows anyone acts on.
  const ordered = [...rows].sort((a, b) => a.onHand / Math.max(1, a.reorderLevel) - b.onHand / Math.max(1, b.reorderLevel));
  const shown = filterRows(ordered, q);

  const below = rows.filter((p) => p.onHand < p.reorderLevel);

  return (
    <ModuleScreen
      tabs={<Tabs current="/dms/inventory/spare-parts" tabs={partTabs({ parts: rows.length, orders: data.part_orders.length })} />}
      href="/dms/inventory/spare-parts"
      exportCollection="spare_parts"
      searchPlaceholder="Search parts"
      toolbar={
        <Disclosure label="Add part" open={params.new === "1"}>
          <ActionForm action={createSparePart} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="field-label">SKU</label>
              <input name="sku" required maxLength={24} className="field" placeholder="SP-BAT-100" />
            </div>
            <div>
              <label className="field-label">Part</label>
              <input name="name" required maxLength={80} className="field" placeholder="48V 100Ah Lithium Pack" />
            </div>
            <div>
              <label className="field-label">Category</label>
              <select name="category" className="field" defaultValue="Battery">
                {PART_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Location</label>
              <input name="location" maxLength={60} defaultValue="Pune Plant" className="field" />
            </div>
            <div>
              <label className="field-label">Opening stock</label>
              <input name="onHand" type="number" min={0} step={1} defaultValue={0} className="field" />
            </div>
            <div>
              <label className="field-label">Reorder at</label>
              <input name="reorderLevel" type="number" min={0} step={1} defaultValue={10} className="field" />
            </div>
            <div>
              <label className="field-label">Unit price (₹)</label>
              <input name="unitPrice" type="number" min={1} step={1} defaultValue={1000} className="field" />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <SubmitButton>Add part</SubmitButton>
              <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                Opening stock is logged as a receipt, so the inventory logs still add up.
              </p>
            </div>
          </ActionForm>
        </Disclosure>
      }
      stats={[
        { label: "SKUs", value: String(rows.length), hint: `${shown.length} shown` },
        { label: "Below reorder level", value: String(below.length), hint: "Receive stock from the row", tone: below.length ? "warning" : "neutral" },
        { label: "Out of stock", value: String(rows.filter((p) => p.onHand === 0).length), hint: "Nothing on the shelf" },
        { label: "Stock value", value: formatINR(rows.reduce((s, p) => s + p.onHand * p.unitPrice, 0)), hint: "On-hand quantity × unit price" },
      ]}
    >
      <DataTable rows={shown} columns={COLUMNS} empty="No parts match that search." />
    </ModuleScreen>
  );
}
