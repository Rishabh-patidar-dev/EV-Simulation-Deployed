import Link from "next/link";
import ModuleScreen from "@/components/shell/ModuleScreen";
import DonutChart from "@/components/charts/DonutChart";
import ActionForm from "@/components/ui/ActionForm";
import { MagnitudeBars } from "@/components/ui/cards";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, Pill, StatusPill, formatDate, formatINR, relativeTime } from "@/components/ui/primitives";
import { FilterChips, Hint, withParams } from "@/components/ui/workflow";
import { vehiclesOnRoad } from "@/lib/fleet";
import { filterRows } from "@/lib/search";
import { APPROVED_CHARGERS, CLAIM_COMPONENTS, approvedCost, componentCover, recoveredAmount } from "@/lib/warranty";
import { raiseClaim } from "@/server/actions/warranty";
import { readMany } from "@/server/store";
import type { WarrantyClaim } from "@/server/types";

export const dynamic = "force-dynamic";

const STATUSES: Array<WarrantyClaim["status"]> = ["Submitted", "Under Review", "Info Requested", "Approved", "In Repair", "Reimbursed", "Recovery", "Closed", "Rejected"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const COLUMNS: Column<WarrantyClaim>[] = [
  {
    key: "no",
    header: "Claim",
    render: (c) => (
      <Link href={`/dms/service/warranty/${c.id}`} className="block hover:underline">
        <span className="block font-medium" style={{ color: "var(--brand-ink)" }}>
          {c.claimNo}
        </span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {c.jobCardId ? "from a job card" : c.customer ?? c.dealer}
        </span>
      </Link>
    ),
  },
  { key: "dealer", header: "Dealer", render: (c) => c.dealer, secondary: true },
  {
    key: "component",
    header: "Component",
    render: (c) => (
      <span className="block">
        <Pill tone="brand">{c.component}</Pill>
        <span className="mt-0.5 block font-mono text-[11px]" style={{ color: "var(--fg-muted)" }}>
          {c.vin}
        </span>
      </span>
    ),
  },
  {
    key: "amount",
    header: "Claimed",
    align: "right",
    render: (c) => (
      <span className="block whitespace-nowrap">
        <span className="block">{formatINR(c.claimedAmount)}</span>
        {c.approvedAmount != null && c.status !== "Rejected" && (
          <span className="block text-[11.5px]" style={{ color: "var(--positive)" }}>
            {formatINR(c.approvedAmount)} approved
          </span>
        )}
      </span>
    ),
  },
  {
    key: "engine",
    header: "Rules",
    secondary: true,
    render: (c) => (c.adjudication ? <StatusPill value={c.adjudication.decision} /> : <span style={{ color: "var(--fg-faint)" }}>—</span>),
  },
  { key: "status", header: "Status", render: (c) => <StatusPill value={c.status} /> },
  { key: "raised", header: "Raised", align: "right", secondary: true, render: (c) => relativeTime(c.raisedAt) },
];

/**
 * Warranty Claims — EV-CRM's warranty module: a coverage check by chassis,
 * claim intake that the rules engine adjudicates on arrival, and the cost of
 * warranty by component, model and supplier, net of what was recovered.
 * Each claim opens on its own page, where it is worked to the end.
 */
export default async function WarrantyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const statusParam = one(raw.status);
  const status = (STATUSES as string[]).includes(statusParam) ? (statusParam as WarrantyClaim["status"]) : undefined;
  const checkVin = one(raw.vin).trim().toUpperCase();

  const { data } = await readMany(["warranty_claims", "dealers", "vehicle_units", "bookings", "deliveries", "registrations", "job_cards", "telematics", "products"] as const);
  const rows = data.warranty_claims;

  // Claims waiting on a person first, then work in progress, then history.
  const ordered = [...rows].sort((a, b) => rank(a) - rank(b) || +new Date(b.raisedAt) - +new Date(a.raisedAt));
  const shown = filterRows(ordered, q).filter((c) => !status || c.status === status || (status === "Closed" && c.status === "Recovered"));

  const awaiting = rows.filter((c) => c.status === "Submitted" || c.status === "Under Review" || c.status === "Info Requested");
  const adjudicated = rows.filter((c) => c.adjudication);
  const auto = adjudicated.filter((c) => c.adjudication?.decision !== "Needs review");
  const approvedTotal = rows.reduce((s, c) => s + approvedCost(c), 0);
  const recoveredTotal = rows.reduce((s, c) => s + recoveredAmount(c), 0);
  const toReimburse = rows.filter((c) => c.status === "Approved" || c.status === "In Repair");

  // Cost of warranty — EV-CRM's cost analytics: by component, by model, by supplier.
  const sum = (key: (c: WarrantyClaim) => string | null | undefined) => {
    const out = new Map<string, number>();
    for (const c of rows) {
      const cost = approvedCost(c);
      if (!cost) continue;
      const k = key(c) ?? "Unknown";
      out.set(k, (out.get(k) ?? 0) + cost);
    }
    return [...out.entries()].sort((a, b) => b[1] - a[1]);
  };
  const byComponent = sum((c) => c.component);
  const byModel = sum((c) => c.model).slice(0, 6);
  const bySupplier = sum((c) => c.recovery?.supplier ?? (c.status === "Recovered" ? "Recovered (no supplier on record)" : "Not yet recovered")).slice(0, 6);

  // Instant coverage check (§4.4c in the CRM's brief): every component on one chassis.
  const onRoad = checkVin ? vehiclesOnRoad(data).find((v) => v.unit.vin === checkVin) : undefined;
  const checkedUnit = checkVin ? data.vehicle_units.find((u) => u.vin === checkVin) : undefined;
  const product = data.products.find((p) => p.model === (onRoad?.unit.model ?? checkedUnit?.model));
  const device = checkVin ? data.telematics.find((t) => t.vin === checkVin) : undefined;

  return (
    <ModuleScreen
      href="/dms/service/warranty"
      exportCollection="warranty_claims"
      searchPlaceholder="Search claims, chassis or customer"
      stats={[
        { label: "Awaiting a person", value: String(awaiting.length), hint: "Under review or waiting on the dealer", tone: awaiting.length ? "warning" : "neutral" },
        {
          label: "Decided by the rules",
          value: adjudicated.length ? `${Math.round((auto.length / adjudicated.length) * 100)}%` : "—",
          hint: `${auto.length} of ${adjudicated.length} auto-approved or voided`,
        },
        { label: "Approved cost", value: formatINR(approvedTotal), hint: `${toReimburse.length} still to reimburse` },
        { label: "Net cost", value: formatINR(approvedTotal - recoveredTotal), hint: `${formatINR(recoveredTotal)} recovered from suppliers`, tone: approvedTotal - recoveredTotal > 0 ? "warning" : "neutral" },
      ]}
      toolbar={
        <>
          <section className="surface px-5 py-4">
            <form action="/dms/service/warranty" className="flex flex-wrap items-end gap-2">
              <div className="min-w-[14rem] flex-1">
                <label className="field-label" htmlFor="coverage-vin">
                  Coverage check — is this vehicle still in warranty?
                </label>
                <input id="coverage-vin" name="vin" defaultValue={checkVin} maxLength={17} className="field num uppercase" placeholder="Chassis number (VIN)" />
              </div>
              <button type="submit" className="btn btn-primary">
                Check coverage
              </button>
              {checkVin && (
                <Link href="/dms/service/warranty" className="btn btn-ghost">
                  Clear
                </Link>
              )}
            </form>
            {checkVin && (
              <div className="mt-4">
                {!onRoad ? (
                  <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                    {checkedUnit
                      ? `${checkVin} is a ${checkedUnit.model} that is ${checkedUnit.status.toLowerCase()} — cover starts at handover.`
                      : `No vehicle ${checkVin} in this network.`}
                  </p>
                ) : (
                  <>
                    <p className="mb-2 text-[12.5px]">
                      <span className="font-semibold">{onRoad.unit.model}</span> · {onRoad.customer} · handed over {formatDate(onRoad.deliveredAt)} by {onRoad.dealer}
                      {device ? ` · ${device.odometerKm.toLocaleString("en-IN")} km, battery SoH ${device.soh}% (telematics)` : ""}
                      {product?.warranty ? ` · published warranty ${product.warranty}` : ""}
                    </p>
                    <div className="overflow-x-auto">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Component</th>
                            <th>Term</th>
                            <th>Covered until</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {CLAIM_COMPONENTS.map((component) => {
                            const { plan, ends, state } = componentCover(component, onRoad.deliveredAt, product?.warranty, device?.odometerKm ?? null);
                            return (
                              <tr key={component}>
                                <td className="font-medium">{component}</td>
                                <td>
                                  {plan.termMonths} months{plan.termKm ? ` / ${plan.termKm.toLocaleString("en-IN")} km` : ""}
                                  {plan.sohFloorPct ? ` · SoH below ${plan.sohFloorPct}%` : ""}
                                </td>
                                <td>{formatDate(ends)}</td>
                                <td>
                                  <Pill tone={state === "In warranty" ? "positive" : state === "Ends soon" ? "warning" : "negative"}>{state}</Pill>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>

          <Disclosure label="Raise a claim" open={one(raw.new) === "1"}>
            <ActionForm action={raiseClaim} resetOnSuccess className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="field-label" htmlFor="wc-dealer">
                    Dealer
                  </label>
                  <select id="wc-dealer" name="dealer" required className="field" defaultValue={onRoad?.dealer ?? ""}>
                    <option value="" disabled>
                      Choose a dealer
                    </option>
                    {data.dealers.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="wc-vin">
                    Chassis (VIN)
                  </label>
                  <input id="wc-vin" name="vin" required maxLength={17} defaultValue={onRoad ? checkVin : ""} className="field num uppercase" />
                </div>
                <div>
                  <label className="field-label" htmlFor="wc-component">
                    Failed component
                  </label>
                  <select id="wc-component" name="component" required className="field" defaultValue="">
                    <option value="" disabled>
                      Choose one
                    </option>
                    {CLAIM_COMPONENTS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="wc-amount">
                    Claimed (₹)
                  </label>
                  <input id="wc-amount" name="claimedAmount" type="number" min={100} max={1000000} required className="field" />
                </div>
                <div>
                  <label className="field-label" htmlFor="wc-customer">
                    Customer
                  </label>
                  <input id="wc-customer" name="customer" maxLength={80} defaultValue={onRoad?.customer ?? ""} className="field" placeholder="From the sale if blank" />
                </div>
                <div>
                  <label className="field-label" htmlFor="wc-phone">
                    Customer phone
                  </label>
                  <input id="wc-phone" name="customerPhone" type="tel" maxLength={20} defaultValue={onRoad?.phone ?? ""} className="field" />
                </div>
                <div>
                  <label className="field-label" htmlFor="wc-odo">
                    Odometer (km)
                  </label>
                  <input id="wc-odo" name="odometerKm" type="number" min={0} className="field" placeholder="Telematics if blank" />
                </div>
                <div>
                  <label className="field-label" htmlFor="wc-soh">
                    Battery SoH % (battery only)
                  </label>
                  <input id="wc-soh" name="measuredSohPct" type="number" min={0} max={100} className="field" placeholder="Telematics if blank" />
                </div>
                <div>
                  <label className="field-label" htmlFor="wc-charger">
                    Charger used (battery only)
                  </label>
                  <input id="wc-charger" name="chargerType" list="wc-chargers" maxLength={60} className="field" />
                  <datalist id="wc-chargers">
                    {APPROVED_CHARGERS.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="field-label" htmlFor="wc-issue">
                    What failed
                  </label>
                  <input id="wc-issue" name="issue" required minLength={5} maxLength={500} className="field" placeholder="e.g. Range down to 40 km on a full charge; pack swells when charging" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton>Raise claim</SubmitButton>
                <Hint>
                  The rules decide on arrival: time and km since handover, battery SoH below 70%, an approved charger, free services done in the network, and no duplicate claim. Clean
                  claims are approved, a broken rule voids the claim, missing evidence goes to a reviewer. Workshop claims are raised by closing the job card.
                </Hint>
              </div>
            </ActionForm>
          </Disclosure>
        </>
      }
      aside={
        <>
          <Card>
            <CardHeader title="Cost by component" subtitle="Approved amounts, every claim" />
            <div className="px-5 pb-6 pt-1">
              {byComponent.length ? <DonutChart data={byComponent.map(([label, value]) => ({ label, value }))} format="inr" centerLabel="approved" /> : <Empty>Nothing approved yet.</Empty>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Cost by model" subtitle="Which vehicles cost the most in warranty" />
            <div className="px-5 pb-5 pt-1">
              {byModel.length ? <MagnitudeBars data={byModel.map(([label, value]) => ({ key: label, label, value, display: formatINR(value) }))} /> : <Empty>Nothing approved yet.</Empty>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Cost by supplier" subtitle="Where approved cost is being recovered from" />
            <div className="px-5 pb-5 pt-1">
              {bySupplier.length ? (
                <MagnitudeBars data={bySupplier.map(([label, value]) => ({ key: label, label, value, display: formatINR(value), muted: label === "Not yet recovered" }))} />
              ) : (
                <Empty>Nothing approved yet.</Empty>
              )}
            </div>
          </Card>
        </>
      }
    >
      <FilterChips
        options={STATUSES.map((s) => ({ value: s, count: rows.filter((c) => c.status === s || (s === "Closed" && c.status === "Recovered")).length })).filter((o) => o.count > 0 || o.value === status)}
        current={status}
        hrefFor={(s) => withParams("/dms/service/warranty", { q, status: s })}
        total={rows.length}
      />
      <DataTable rows={shown} columns={COLUMNS} empty={q || status ? "No claim matches those filters." : "No claims yet — raise one above, or close a job card with warranty work."} />
    </ModuleScreen>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <p className="py-3 text-center text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
      {children}
    </p>
  );
}

function rank(c: WarrantyClaim) {
  const order: Record<WarrantyClaim["status"], number> = {
    Submitted: 0,
    "Under Review": 0,
    "Info Requested": 1,
    Approved: 2,
    "In Repair": 2,
    Reimbursed: 3,
    Recovery: 3,
    Rejected: 4,
    Closed: 5,
    Recovered: 5,
  };
  return order[c.status];
}
