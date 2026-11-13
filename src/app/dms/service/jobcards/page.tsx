import Link from "next/link";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, Pill, StatusPill, formatINR, relativeTime } from "@/components/ui/primitives";
import { FilterChips, Hint, withParams } from "@/components/ui/workflow";
import { vehiclesOnRoad } from "@/lib/fleet";
import { filterRows } from "@/lib/search";
import { FREE_SERVICES, LABOUR_RATE } from "@/lib/service";
import { daysSinceIso, daysUntilIso, isPast } from "@/lib/time";
import { openJobCard, sendServiceReminder } from "@/server/actions/service";
import { assignableStaff } from "@/server/staff";
import { readMany } from "@/server/store";
import { JOB_FLOW, JOB_TYPES, type JobCard } from "@/server/types";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATUSES = [...JOB_FLOW, "Awaiting Parts", "Cancelled"] as const;
const live = (j: JobCard) => j.status !== "Closed" && j.status !== "Cancelled";
const billed = (j: JobCard) =>
  j.labour.filter((l) => l.billTo === "Customer").reduce((s, l) => s + l.hours * l.rate, 0) + j.parts.filter((p) => p.billTo === "Customer").reduce((s, p) => s + p.quantity * p.unitPrice, 0);

const COLUMNS: Column<JobCard>[] = [
  {
    key: "job",
    header: "Job card",
    render: (j) => (
      <Link href={`/dms/service/jobcards/${j.id}`} className="block hover:underline">
        <span className="block font-medium" style={{ color: "var(--brand-ink)" }}>
          {j.jobNo}
        </span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {j.customer} · {j.registrationNo ?? j.vin}
        </span>
      </Link>
    ),
  },
  { key: "type", header: "Job", secondary: true, render: (j) => `${j.serviceType}${j.freeServiceNo ? ` #${j.freeServiceNo}` : ""}` },
  { key: "complaint", header: "Complaint", secondary: true, render: (j) => <span className="block max-w-[16rem] truncate">{j.complaints[0]?.complaint}</span> },
  { key: "tech", header: "Technician", secondary: true, render: (j) => j.technician },
  { key: "bill", header: "Customer pays", align: "right", render: (j) => <span className="whitespace-nowrap">{formatINR(Math.round(billed(j) * 1.18))}</span> },
  {
    key: "status",
    header: "Status",
    render: (j) => (
      <span className="flex flex-wrap items-center gap-1">
        <StatusPill value={j.status} />
        {live(j) && j.status !== "Ready" && isPast(j.promisedAt) && <Pill tone="negative">Past promise</Pill>}
      </span>
    ),
  },
  { key: "opened", header: "Opened", align: "right", render: (j) => <span className="whitespace-nowrap">{relativeTime(j.openedAt)}</span> },
];

/**
 * Service job cards — the workshop's register, the intake form, and the
 * service reminders due across every vehicle on the road.
 */
export default async function JobCardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const statusParam = one(raw.status);
  const status = (STATUSES as readonly string[]).includes(statusParam) ? (statusParam as JobCard["status"]) : undefined;

  const [{ data }, technicians] = await Promise.all([
    readMany(["job_cards", "vehicle_units", "bookings", "deliveries", "registrations", "dealers"] as const),
    assignableStaff("service.manage"),
  ]);
  const rows = data.job_cards;
  const shown = filterRows(rows, q).filter((j) => !status || j.status === status);
  const open = rows.filter(live);
  const closed30 = rows.filter((j) => j.status === "Closed" && j.closedAt && daysSinceIso(j.closedAt) <= 30);
  const onRoad = vehiclesOnRoad(data);
  const due = onRoad.filter((v) => daysUntilIso(v.next.dueAt) <= 15).sort((a, b) => +new Date(a.next.dueAt) - +new Date(b.next.dueAt));
  const prefill = onRoad.find((v) => v.unit.vin === one(raw.vin));
  const dealers = data.dealers.filter((d) => d.status !== "Suspended").sort((a, b) => a.name.localeCompare(b.name));

  return (
    <ModuleScreen
      href="/dms/service/jobcards"
      exportCollection="job_cards"
      searchPlaceholder="Search job cards, VIN, number or customer"
      stats={[
        { label: "In the workshop", value: String(open.length), hint: `${rows.filter((j) => j.status === "Awaiting Parts").length} waiting on parts` },
        { label: "Ready for pickup", value: String(rows.filter((j) => j.status === "Ready").length), hint: "Close to bill" },
        { label: "Closed, 30 days", value: String(closed30.length), hint: formatINR(Math.round(closed30.reduce((s, j) => s + billed(j), 0) * 1.18)) + " billed" },
        { label: "Service due in 15 days", value: String(due.length), hint: `${due.filter((v) => daysUntilIso(v.next.dueAt) < 0).length} overdue`, tone: due.some((v) => daysUntilIso(v.next.dueAt) < 0) ? "warning" : "neutral" },
      ]}
      toolbar={
        <Disclosure label={prefill ? `Open a job card for ${prefill.registrationNo ?? prefill.unit.vin}` : "Open a job card"} open={one(raw.new) === "1" || Boolean(prefill)}>
          <ActionForm action={openJobCard} resetOnSuccess className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="lg:col-span-2">
                <label className="field-label" htmlFor="job-vin">
                  Vehicle (chassis number)
                </label>
                <input id="job-vin" name="vin" required list="job-vins" maxLength={17} className="field num uppercase" defaultValue={prefill?.unit.vin} placeholder="MA3LX…" />
                <datalist id="job-vins">
                  {onRoad.map((v) => (
                    <option key={v.unit.id} value={v.unit.vin}>
                      {v.registrationNo ?? "Unregistered"} · {v.unit.model} · {v.customer}
                    </option>
                  ))}
                </datalist>
              </div>
              <div>
                <label className="field-label" htmlFor="job-km">
                  Odometer (km)
                </label>
                <input id="job-km" name="odometerKm" type="number" min={0} max={500000} required className="field" />
              </div>
              <div>
                <label className="field-label" htmlFor="job-type">
                  Job
                </label>
                <select id="job-type" name="serviceType" className="field" defaultValue={prefill?.next.freeServiceNo ? "Free Service" : "Paid Service"}>
                  {JOB_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="job-dealer">
                  Workshop
                </label>
                <select id="job-dealer" name="dealer" className="field" defaultValue={prefill?.dealer ?? ""}>
                  <option value="">The selling dealer</option>
                  {dealers.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="job-tech">
                  Technician
                </label>
                <select id="job-tech" name="technician" className="field">
                  {technicians.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="job-customer">
                  Customer (if not on record)
                </label>
                <input id="job-customer" name="customer" maxLength={120} className="field" defaultValue={prefill?.customer} />
              </div>
              <div>
                <label className="field-label" htmlFor="job-phone">
                  Mobile
                </label>
                <input id="job-phone" name="phone" inputMode="tel" className="field" defaultValue={prefill?.phone ?? ""} />
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="field-label">Complaints, in the customer&apos;s words</legend>
              {[0, 1, 2].map((i) => (
                <input key={i} name="complaint" maxLength={200} required={i === 0} className="field" placeholder={i === 0 ? "e.g. Range dropped to 60 km on a full charge" : "Another complaint (optional)"} aria-label={`Complaint ${i + 1}`} />
              ))}
            </fieldset>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton>Open job card</SubmitButton>
              <Hint>
                Labour at ₹{LABOUR_RATE}/h before GST. {FREE_SERVICES.length} free services per vehicle, then paid every 6 months or 10,000 km.
              </Hint>
            </div>
          </ActionForm>
        </Disclosure>
      }
      aside={
        <Card>
          <CardHeader title="Service due" subtitle="Next 15 days and overdue — by date" />
          <ul className="space-y-2.5 px-5 pb-5 pt-1">
            {due.slice(0, 8).map((v) => {
              const days = daysUntilIso(v.next.dueAt);
              return (
                <li key={v.unit.id} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link href={withParams("/dms/service/jobcards", { vin: v.unit.vin })} className="min-w-0 truncate text-[12.5px] font-medium hover:underline">
                      {v.registrationNo ?? v.unit.vin}
                    </Link>
                    <span className="shrink-0 text-[11.5px]" style={{ color: days < 0 ? "var(--negative)" : "var(--fg-muted)" }}>
                      {days < 0 ? `${-days}d overdue` : `in ${days}d`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                      {v.next.label} · {v.customer}
                    </span>
                    {v.phone && (
                      <ActionForm action={sendServiceReminder.bind(null, v.unit.id)}>
                        <SubmitButton size="sm" tone="ghost">
                          Remind
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                </li>
              );
            })}
            {due.length === 0 && (
              <li className="py-3 text-center text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                Nothing due in the next 15 days.
              </li>
            )}
            {due.length > 8 && <li className="text-[11.5px]" style={{ color: "var(--fg-faint)" }}>+{due.length - 8} more due</li>}
          </ul>
          <p className="px-5 pb-4 text-[11px]" style={{ color: "var(--fg-faint)" }}>
            {onRoad.length} vehicles on the road · scheduled from the handover date, then from each service.
          </p>
        </Card>
      }
    >
      <FilterChips
        total={rows.length}
        current={status}
        hrefFor={(value) => withParams("/dms/service/jobcards", { q, status: value })}
        options={STATUSES.map((s) => ({ value: s, count: rows.filter((j) => j.status === s).length }))}
      />
      <DataTable rows={shown} columns={COLUMNS} empty={q || status ? "No job card matches those filters." : "No job cards yet — open one when a vehicle comes in."} />
    </ModuleScreen>
  );
}
