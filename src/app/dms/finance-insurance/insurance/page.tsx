import Link from "next/link";
import { financeTabs } from "@/components/finance/tabs";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { FilterChips, Hint, SimulatedNote, Tabs, withParams } from "@/components/ui/workflow";
import { rupees } from "@/lib/gst";
import { idvFor, quoteInsurance } from "@/lib/insurance";
import { filterRows } from "@/lib/search";
import { isThisMonth } from "@/lib/time";
import { cancelPolicy, issuePolicies } from "@/server/actions/finance";
import { readMany } from "@/server/store";
import { INSURERS, type InsurancePolicy } from "@/server/types";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

type Row = InsurancePolicy & { delivered: boolean };

const COLUMNS: Column<Row>[] = [
  {
    key: "policy",
    header: "Policy",
    render: (p) => (
      <span className="block">
        <span className="block font-medium">{p.policyNo}</span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {p.customer} · {p.vin ?? "no chassis"}
        </span>
      </span>
    ),
  },
  { key: "insurer", header: "Insurer", secondary: true, render: (p) => `${p.insurer} · ${p.cover}` },
  { key: "idv", header: "IDV", align: "right", secondary: true, render: (p) => formatINR(p.idv) },
  { key: "premium", header: "Premium", align: "right", render: (p) => <span className="whitespace-nowrap">{formatINR(p.premium)}</span> },
  { key: "status", header: "Status", render: (p) => <StatusPill value={p.status} /> },
  { key: "valid", header: "Valid until", align: "right", render: (p) => <span className="whitespace-nowrap">{formatDate(p.endsOn)}</span> },
  {
    key: "cancel",
    header: "",
    render: (p) =>
      p.status === "Issued" && !p.delivered ? (
        <details className="relative">
          <summary className="cursor-pointer text-[12px]" style={{ color: "var(--negative)" }}>
            Cancel
          </summary>
          <ActionForm action={cancelPolicy.bind(null, p.id)} className="absolute right-0 z-10 mt-1 w-64 space-y-2 rounded-[10px] p-3 surface">
            <input name="reason" required minLength={3} maxLength={200} className="field" placeholder="Reason" aria-label="Reason" />
            <SubmitButton size="sm" tone="danger">
              Cancel policy
            </SubmitButton>
          </ActionForm>
        </details>
      ) : null,
  },
];

/**
 * Motor insurance, issued per chassis before handover: compare the panel's
 * quotes for a booking's vehicles, issue the chosen policy on every one of
 * them, and track the commission it earns the dealer.
 */
export default async function InsurancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const insurerFilter = one(raw.insurer) || undefined;

  const { data } = await readMany(["insurance_policies", "vehicle_units", "bookings", "products", "finance_cases", "financiers"] as const);
  const unitById = new Map(data.vehicle_units.map((u) => [u.id, u]));
  const rows: Row[] = data.insurance_policies.map((p) => ({ ...p, delivered: unitById.get(p.vehicleUnitId ?? "")?.status === "Delivered" }));
  const shown = filterRows(rows, q).filter((p) => !insurerFilter || p.insurer === insurerFilter);
  const inForce = rows.filter((p) => p.status === "Issued");

  // Bookings with vehicles allocated but not yet insured.
  const insured = new Set(inForce.map((p) => p.vehicleUnitId));
  const needing = data.bookings
    .filter((b) => b.status !== "Cancelled" && b.status !== "Delivered")
    .map((b) => ({ booking: b, units: data.vehicle_units.filter((u) => u.bookingId === b.id && !insured.has(u.id)) }))
    .filter((x) => x.units.length > 0);
  const selected = needing.find((x) => x.booking.id === one(raw.booking)) ?? needing[0];
  const product = selected ? data.products.find((p) => p.model === selected.booking.model) : undefined;
  const firstUnit = selected?.units[0];
  const exShowroom = firstUnit ? (product?.variants.find((v) => v.variant === firstUnit.variant)?.exShowroom ?? firstUnit.price) : 0;
  const quotes = selected ? quoteInsurance(idvFor(exShowroom), product?.rtoClass ?? "e-Rickshaw", "Comprehensive") : [];
  const tpOnly = selected ? quoteInsurance(idvFor(exShowroom), product?.rtoClass ?? "e-Rickshaw", "Third Party Only") : [];

  return (
    <ModuleScreen
      href="/dms/finance-insurance"
      exportCollection="insurance_policies"
      searchPlaceholder="Search policies, chassis or customers"
      tabs={<Tabs current="/dms/finance-insurance/insurance" tabs={financeTabs({ loans: data.finance_cases.length, policies: rows.length, financiers: data.financiers.length })} />}
      stats={[
        { label: "Policies in force", value: String(inForce.length), hint: `${rows.length - inForce.length} cancelled` },
        { label: "Premium this month", value: formatINR(inForce.filter((p) => isThisMonth(p.issuedAt)).reduce((s, p) => s + p.premium, 0)), hint: "GST included" },
        { label: "Commission accrued", value: formatINR(inForce.filter((p) => p.commissionStatus === "Accrued").reduce((s, p) => s + p.commission, 0)), hint: "Collect under Payouts" },
        {
          label: "Vehicles awaiting cover",
          value: String(needing.reduce((s, x) => s + x.units.length, 0)),
          hint: "Allocated but uninsured",
          tone: needing.length ? "warning" : "neutral",
        },
      ]}
      toolbar={
        selected ? (
          <section className="surface overflow-hidden" aria-label="Quote and issue">
            <header className="flex flex-wrap items-end justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <div>
                <h2 className="text-[14px] font-semibold">Compare and issue</h2>
                <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
                  {selected.booking.bookingNo} · {selected.booking.customer} · {selected.units.length} {selected.booking.model} awaiting cover · IDV {rupees(idvFor(exShowroom))} each
                </p>
              </div>
              {needing.length > 1 && (
                <form method="get" action="/dms/finance-insurance/insurance" className="flex items-center gap-2">
                  <select name="booking" className="field py-1.5! text-[12px]" defaultValue={selected.booking.id} aria-label="Booking to insure">
                    {needing.map((x) => (
                      <option key={x.booking.id} value={x.booking.id}>
                        {x.booking.bookingNo} · {x.booking.customer} · {x.units.length} uninsured
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn btn-ghost btn-sm">
                    Show
                  </button>
                </form>
              )}
            </header>
            <ActionForm action={issuePolicies.bind(null, selected.booking.id)} className="space-y-3 p-4">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th />
                      <th>Insurer</th>
                      <th className="text-right">Own damage</th>
                      <th className="text-right">Third party</th>
                      <th className="text-right">GST</th>
                      <th className="text-right">Premium / vehicle</th>
                      <th className="text-right">TP only</th>
                      <th className="text-right">Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map((quote, i) => (
                      <tr key={quote.insurer}>
                        <td>
                          <input type="radio" name="insurer" value={quote.insurer} defaultChecked={i === 0} aria-label={quote.insurer} />
                        </td>
                        <td className="font-medium">
                          {quote.insurer}
                          {i === 0 && <span className="ml-1.5 text-[11px]" style={{ color: "var(--positive)" }}>cheapest</span>}
                        </td>
                        <td className="num text-right">{rupees(quote.odPremium)}</td>
                        <td className="num text-right">{rupees(quote.tpPremium)}</td>
                        <td className="num text-right">{rupees(quote.gst)}</td>
                        <td className="num text-right font-semibold">{rupees(quote.premium)}</td>
                        <td className="num text-right">{rupees(tpOnly.find((t) => t.insurer === quote.insurer)?.premium ?? 0)}</td>
                        <td className="num text-right">
                          {rupees(quote.commission)} ({quote.commissionPct}%)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-[12.5px]">
                  <input type="radio" name="cover" value="Comprehensive" defaultChecked /> Comprehensive
                </label>
                <label className="flex items-center gap-1.5 text-[12.5px]">
                  <input type="radio" name="cover" value="Third Party Only" /> Third party only
                </label>
                <SubmitButton>
                  Issue {selected.units.length} polic{selected.units.length === 1 ? "y" : "ies"}
                </SubmitButton>
              </div>
              <SimulatedNote>Indicative premiums, not any insurer&apos;s tariff — third party by RTO class, own damage on the IDV (ex-showroom less 5%), 18% GST.</SimulatedNote>
            </ActionForm>
          </section>
        ) : (
          <Hint>No vehicle is waiting for cover. Vehicles appear here once they are allocated to a booking in Vehicle Delivery.</Hint>
        )
      }
      aside={
        <Card>
          <CardHeader title="Share by insurer" subtitle="Policies in force" />
          <ul className="space-y-2 px-5 pb-5 pt-1">
            {INSURERS.map((name) => {
              const count = inForce.filter((p) => p.insurer === name).length;
              return (
                <li key={name} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <Link href={withParams("/dms/finance-insurance/insurance", { insurer: name })} className="hover:underline">
                    {name}
                  </Link>
                  <span className="num">{count}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      }
    >
      <FilterChips
        total={rows.length}
        current={insurerFilter}
        hrefFor={(value) => withParams("/dms/finance-insurance/insurance", { q, insurer: value })}
        options={INSURERS.map((i) => ({ value: i, count: rows.filter((p) => p.insurer === i).length }))}
      />
      <DataTable rows={shown} columns={COLUMNS} empty={q || insurerFilter ? "No policy matches those filters." : "No policies yet."} />
    </ModuleScreen>
  );
}
