import ModuleScreen from "@/components/shell/ModuleScreen";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { MagnitudeBars, Panel } from "@/components/ui/cards";
import { Pill, relativeTime } from "@/components/ui/primitives";
import { FilterChips, withParams } from "@/components/ui/workflow";
import { ADJUSTMENT_REASONS } from "@/lib/inventory";
import { istTimestamp } from "@/lib/time";
import { filterRows } from "@/lib/search";
import { readCollection } from "@/server/store";
import type { InventoryLog } from "@/server/types";

export const dynamic = "force-dynamic";

const ENTITIES: InventoryLog["entity"][] = ["Vehicle", "Spare Part"];
const DIRECTION_LABEL: Record<InventoryLog["direction"], string> = { IN: "Inward", OUT: "Outward" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
/** Range bounds for a `yyyy-mm-dd` filter, read in IST: start inclusive, end exclusive. */
const dayStart = (day: string) => (day ? new Date(`${day}T00:00:00+05:30`).getTime() : null);
const dayAfter = (day: string) => {
  const start = dayStart(day);
  return start === null ? null : start + 86_400_000;
};

const COLUMNS: Column<InventoryLog>[] = [
  {
    key: "at",
    header: "When",
    render: (l) => (
      <span className="block">
        <span className="block">{relativeTime(l.at)}</span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {istTimestamp(l.at)}
        </span>
      </span>
    ),
  },
  { key: "entity", header: "Entity", render: (l) => <Pill tone="neutral">{l.entity}</Pill> },
  { key: "ref", header: "Reference", render: (l) => <span className="font-medium">{l.reference}</span> },
  {
    key: "direction",
    header: "Movement",
    render: (l) => <Pill tone={l.direction === "IN" ? "positive" : "warning"}>{DIRECTION_LABEL[l.direction]}</Pill>,
  },
  {
    key: "qty",
    header: "Qty",
    align: "right",
    render: (l) => (
      <span className="num" style={{ color: l.direction === "IN" ? "var(--positive)" : "var(--negative)" }}>
        {l.direction === "IN" ? "+" : "−"}
        {l.quantity}
      </span>
    ),
  },
  { key: "bucket", header: "Reason", render: (l) => l.bucket, secondary: true },
  { key: "actor", header: "Recorded by", render: (l) => l.actor, secondary: true },
];

/**
 * The stock ledger. Every row is written by whichever module moved the stock —
 * order dispatch and receipt, deliveries, workshop issues and returns, receipts
 * and counts in Spare Parts — so this screen only reads: filter, total, export.
 * Nothing is entered here, or the ledger would stop matching what it explains.
 */
export default async function InventoryLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ rows: movements }, raw] = await Promise.all([readCollection("inventory_logs"), searchParams]);
  const q = one(raw.q);
  const entity = one(raw.entity) || undefined;
  const direction = one(raw.direction) || undefined;
  const reason = one(raw.reason) || undefined;
  const from = one(raw.from);
  const to = one(raw.to);

  const rows = [...movements].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  const reasons = [...new Set(rows.map((l) => l.bucket))].sort((a, b) => a.localeCompare(b));
  const fromAt = dayStart(from);
  const beforeAt = dayAfter(to);

  // Every filter except the entity facet itself, so an entity chip counts what
  // clicking it would actually show — its link carries the other filters on.
  const faceted = filterRows(rows, q).filter((l) => {
    if (direction && l.direction !== direction) return false;
    if (reason && l.bucket !== reason) return false;
    const at = +new Date(l.at);
    if (fromAt !== null && at < fromAt) return false;
    if (beforeAt !== null && at >= beforeAt) return false;
    return true;
  });
  const shown = entity ? faceted.filter((l) => l.entity === entity) : faceted;

  const units = (list: InventoryLog[], dir: InventoryLog["direction"]) =>
    list.filter((l) => l.direction === dir).reduce((s, l) => s + l.quantity, 0);
  const inward = units(shown, "IN");
  const outward = units(shown, "OUT");
  const adjustments = shown.filter((l) => (ADJUSTMENT_REASONS as readonly string[]).includes(l.bucket));

  const byReason = reasons
    .map((name) => {
      const value = shown.filter((l) => l.bucket === name).reduce((s, l) => s + l.quantity, 0);
      return { key: name, label: name, value, display: String(value) };
    })
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const keep = { q, entity, direction, reason, from, to };

  return (
    <ModuleScreen
      href="/dms/inventory/logs"
      exportCollection="inventory_logs"
      searchPlaceholder="Search movements"
      stats={[
        { label: "Movements", value: String(shown.length), hint: `${rows.length} on file` },
        { label: "Inward", value: String(inward), hint: `${shown.filter((l) => l.direction === "IN").length} entries` },
        { label: "Outward", value: String(outward), hint: `${shown.filter((l) => l.direction === "OUT").length} entries` },
        {
          label: "Counts and write-offs",
          value: String(adjustments.length),
          hint: "From stock counts in Spare Parts",
          tone: adjustments.length ? "warning" : "neutral",
        },
      ]}
      aside={
        <Panel title="Units by reason" description="Across the movements shown.">
          {byReason.length ? <MagnitudeBars data={byReason} /> : <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>Nothing in this range.</p>}
        </Panel>
      }
    >
      <FilterChips
        total={faceted.length}
        current={entity}
        hrefFor={(value) => withParams("/dms/inventory/logs", { ...keep, entity: value })}
        options={ENTITIES.map((e) => ({ value: e, count: faceted.filter((l) => l.entity === e).length }))}
      />

      {/* A plain GET form: the filters live in the URL, so a filtered ledger is a link. */}
      <form method="get" className="flex flex-wrap items-end gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
        {q && <input type="hidden" name="q" value={q} />}
        {entity && <input type="hidden" name="entity" value={entity} />}
        <div>
          <label className="field-label" htmlFor="f-direction">
            Movement
          </label>
          <select id="f-direction" name="direction" defaultValue={direction ?? ""} className="field !w-auto py-1.5 text-[12px]">
            <option value="">Any</option>
            {Object.entries(DIRECTION_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="f-reason">
            Reason
          </label>
          <select id="f-reason" name="reason" defaultValue={reason ?? ""} className="field !w-auto py-1.5 text-[12px]">
            <option value="">Any</option>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="f-from">
            From
          </label>
          <input id="f-from" type="date" name="from" defaultValue={from} className="field !w-auto py-1.5 text-[12px]" />
        </div>
        <div>
          <label className="field-label" htmlFor="f-to">
            To
          </label>
          <input id="f-to" type="date" name="to" defaultValue={to} className="field !w-auto py-1.5 text-[12px]" />
        </div>
        <button type="submit" className="btn btn-ghost btn-sm">
          Apply
        </button>
        {(direction || reason || from || to) && (
          <a href={withParams("/dms/inventory/logs", { q, entity })} className="btn btn-ghost btn-sm">
            Clear
          </a>
        )}
      </form>

      <DataTable rows={shown} columns={COLUMNS} empty="No movements match these filters." maxHeight={620} />
    </ModuleScreen>
  );
}
