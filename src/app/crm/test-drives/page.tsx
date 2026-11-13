import Link from "next/link";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, Pill, StatusPill } from "@/components/ui/primitives";
import { FilterChips, Hint, withParams } from "@/components/ui/workflow";
import { filterRows } from "@/lib/search";
import { daysSinceIso, isPast, isToday, istDayKey, upcomingDayKeys } from "@/lib/time";
import { VEHICLE_MODELS } from "@/lib/vehicles";
import { scheduleTestDrive } from "@/server/actions/testDrives";
import { readMany } from "@/server/store";
import { TEST_DRIVE_STATUSES, type TestDrive } from "@/server/types";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const IST = { timeZone: "Asia/Kolkata" } as const;
const slotTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { ...IST, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const dayKey = istDayKey;

const COLUMNS: Column<TestDrive>[] = [
  {
    key: "drive",
    header: "Test drive",
    render: (d) => (
      <Link href={`/crm/test-drives/${d.id}`} className="block hover:underline">
        <span className="block font-medium" style={{ color: "var(--brand-ink)" }}>
          {d.customer}
        </span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {d.driveNo} · {d.bookedVia}
        </span>
      </Link>
    ),
  },
  { key: "model", header: "Model", render: (d) => d.model },
  { key: "dealer", header: "Dealer", secondary: true, render: (d) => d.dealer },
  { key: "slot", header: "Slot", render: (d) => <span className="whitespace-nowrap">{slotTime(d.slotAt)}</span> },
  {
    key: "licence",
    header: "Licence",
    secondary: true,
    render: (d) => (d.licenceVerified ? <Pill tone="positive">Verified</Pill> : d.licenceNo ? <Pill tone="warning">To verify</Pill> : <Pill tone="neutral">Not given</Pill>),
  },
  {
    key: "status",
    header: "Status",
    render: (d) => (
      <span className="flex flex-wrap items-center gap-1">
        <StatusPill value={d.status} />
        {d.feedback && <Pill tone={d.feedback.interest === "Hot" ? "positive" : d.feedback.interest === "Warm" ? "info" : "neutral"}>{d.feedback.interest}</Pill>}
        {d.status === "Scheduled" && isPast(d.slotAt) && <Pill tone="warning">Slot passed</Pill>}
      </span>
    ),
  },
];

/**
 * Test drive scheduling — bookings against each dealer's demo vehicles, the
 * week's calendar, and the conversion from drive to quotation.
 */
export default async function TestDrivesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const statusParam = one(raw.status);
  const status = (TEST_DRIVE_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as TestDrive["status"]) : undefined;

  const { data } = await readMany(["test_drives", "leads", "dealers"] as const);
  const rows = [...data.test_drives].sort((a, b) => +new Date(b.slotAt) - +new Date(a.slotAt));
  const shown = filterRows(rows, q).filter((d) => !status || d.status === status);
  const today = rows.filter((d) => isToday(d.slotAt) && d.status !== "Cancelled");
  const last30 = rows.filter((d) => daysSinceIso(d.slotAt) <= 30 && daysSinceIso(d.slotAt) >= 0);
  const done30 = last30.filter((d) => d.status === "Completed");
  const noShow30 = last30.filter((d) => d.status === "No Show");
  const hot = done30.filter((d) => d.feedback?.interest === "Hot");

  const lead = data.leads.find((l) => l.id === one(raw.lead));
  const bookable = data.leads.filter((l) => l.status !== "Lost" && l.status !== "Converted").sort((a, b) => a.name.localeCompare(b.name));
  const dealers = data.dealers.filter((d) => d.status === "Active").sort((a, b) => a.name.localeCompare(b.name));

  // The week ahead for one dealer — the demo-vehicle calendar.
  const calendarDealer = dealers.find((d) => d.name === one(raw.dealer)) ?? dealers.find((d) => d.name === lead?.dealer) ?? dealers[0];
  const days = upcomingDayKeys(7);
  const week = rows.filter((d) => d.dealer === calendarDealer?.name && (d.status === "Scheduled" || d.status === "Checked In") && days.includes(dayKey(d.slotAt)));

  return (
    <ModuleScreen
      href="/crm/test-drives"
      exportCollection="test_drives"
      searchPlaceholder="Search drives, customers or models"
      stats={[
        { label: "Today", value: String(today.length), hint: `${today.filter((d) => d.status === "Completed").length} done so far` },
        { label: "Completed, 30 days", value: String(done30.length), hint: `${last30.length} booked` },
        {
          label: "No-show rate",
          value: last30.length ? `${Math.round((noShow30.length / last30.length) * 100)}%` : "—",
          hint: "Last 30 days",
          tone: last30.length && noShow30.length / last30.length > 0.2 ? "warning" : "neutral",
        },
        { label: "Hot after the drive", value: done30.length ? `${Math.round((hot.length / done30.length) * 100)}%` : "—", hint: `${hot.length} ready for a quotation` },
      ]}
      toolbar={
        <Disclosure label={lead ? `Book a test drive for ${lead.name}` : "Book a test drive"} open={one(raw.new) === "1" || Boolean(lead)}>
          <form method="get" action="/crm/test-drives" className="mb-4 flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1">
              <label className="field-label" htmlFor="td-lead">
                For a lead (optional)
              </label>
              <select id="td-lead" name="lead" className="field" defaultValue={lead?.id ?? ""}>
                <option value="">— A walk-in —</option>
                {bookable.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {l.model} · {l.status}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-ghost">
              Fill in from the lead
            </button>
          </form>
          <ActionForm action={scheduleTestDrive} resetOnSuccess className="space-y-4">
            {lead && <input type="hidden" name="leadId" value={lead.id} />}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="field-label" htmlFor="td-customer">
                  Customer
                </label>
                <input id="td-customer" name="customer" required maxLength={120} className="field" defaultValue={lead?.name} />
              </div>
              <div>
                <label className="field-label" htmlFor="td-phone">
                  Mobile
                </label>
                <input id="td-phone" name="phone" required inputMode="tel" className="field" defaultValue={lead?.phone} />
              </div>
              <div>
                <label className="field-label" htmlFor="td-model">
                  Model
                </label>
                <select id="td-model" name="model" required className="field" defaultValue={lead?.model ?? ""}>
                  <option value="" disabled>
                    Choose a model
                  </option>
                  {VEHICLE_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="td-dealer">
                  Dealer (demo vehicle)
                </label>
                <select id="td-dealer" name="dealer" required className="field" defaultValue={lead?.dealer && dealers.some((d) => d.name === lead.dealer) ? lead.dealer : ""}>
                  <option value="" disabled>
                    Choose a dealer
                  </option>
                  {dealers.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name} — {d.city}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="td-slot">
                  Date and time (IST)
                </label>
                <input id="td-slot" name="slotAt" type="datetime-local" required className="field" />
              </div>
              <div>
                <label className="field-label" htmlFor="td-duration">
                  Duration
                </label>
                <select id="td-duration" name="durationMin" className="field" defaultValue="30">
                  <option value="30">30 minutes</option>
                  <option value="45">45 minutes</option>
                  <option value="60">1 hour</option>
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="td-via">
                  Booked via
                </label>
                <select id="td-via" name="bookedVia" className="field" defaultValue={lead?.source === "Landing Page" ? "Landing Page" : lead?.source === "WhatsApp" ? "WhatsApp" : "Dealer"}>
                  {["Dealer", "Landing Page", "Call Centre", "WhatsApp"].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="td-licence">
                  Driving licence (optional now)
                </label>
                <input id="td-licence" name="licenceNo" maxLength={20} className="field uppercase" placeholder="MH14 2011 0062821" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton>Book test drive</SubmitButton>
              <Hint>Monday to Saturday, 9:00–18:00. One booking at a time per demo vehicle; the customer gets a WhatsApp confirmation.</Hint>
            </div>
          </ActionForm>
        </Disclosure>
      }
      aside={
        <Card>
          <CardHeader title="Demo calendar" subtitle={calendarDealer ? `${calendarDealer.name} · the next 7 days` : "No active dealer"} />
          {dealers.length > 1 && (
            <form method="get" action="/crm/test-drives" className="flex gap-2 px-5 pb-2">
              <select name="dealer" className="field py-1.5! text-[12px]" defaultValue={calendarDealer?.name} aria-label="Dealer calendar">
                {dealers.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn btn-ghost btn-sm">
                Show
              </button>
            </form>
          )}
          <ol className="space-y-2 px-5 pb-5 pt-1">
            {days.map((day) => {
              const slots = week.filter((d) => dayKey(d.slotAt) === day).sort((a, b) => +new Date(a.slotAt) - +new Date(b.slotAt));
              const label = new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { ...IST, weekday: "short", day: "2-digit", month: "short" });
              return (
                <li key={day}>
                  <p className="text-[11.5px] font-semibold" style={{ color: "var(--fg-muted)" }}>
                    {label}
                  </p>
                  {slots.length ? (
                    <ul className="mt-1 space-y-1">
                      {slots.map((d) => (
                        <li key={d.id} className="flex items-baseline justify-between gap-2 text-[12px]">
                          <Link href={`/crm/test-drives/${d.id}`} className="min-w-0 truncate hover:underline">
                            {new Date(d.slotAt).toLocaleTimeString("en-IN", { ...IST, hour: "2-digit", minute: "2-digit" })} · {d.model}
                          </Link>
                          <span className="shrink-0 truncate" style={{ color: "var(--fg-faint)" }}>
                            {d.customer}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
                      Free
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
      }
    >
      <FilterChips
        total={rows.length}
        current={status}
        hrefFor={(value) => withParams("/crm/test-drives", { q, status: value })}
        options={TEST_DRIVE_STATUSES.map((s) => ({ value: s, count: rows.filter((d) => d.status === s).length }))}
      />
      <DataTable rows={shown} columns={COLUMNS} empty={q || status ? "No test drive matches those filters." : "No test drives yet — book the first one above."} />
    </ModuleScreen>
  );
}
