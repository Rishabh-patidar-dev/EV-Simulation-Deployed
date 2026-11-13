import Link from "next/link";
import ModuleScreen from "@/components/shell/ModuleScreen";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { Card, CardHeader, Pill, StatusPill } from "@/components/ui/primitives";
import { FilterChips, withParams } from "@/components/ui/workflow";
import { TP_WARNING_DAYS } from "@/lib/rto";
import { filterRows } from "@/lib/search";
import { daysSinceIso, daysUntilIso } from "@/lib/time";
import { readMany } from "@/server/store";
import { RTO_FLOW, type Registration } from "@/server/types";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATUSES = [...RTO_FLOW, "Objection"] as const;
const registered = (r: Registration) => r.status === "Approved" || r.status === "RC Issued";

/** The TP countdown, in words and colour — the reason this screen exists. */
function TpLeft({ r }: { r: Registration }) {
  if (registered(r)) return <span style={{ color: "var(--fg-faint)" }}>—</span>;
  const days = daysUntilIso(r.tpValidUntil);
  if (days < 0) return <Pill tone="negative">Lapsed {-days}d ago</Pill>;
  return <Pill tone={days <= TP_WARNING_DAYS ? "warning" : "neutral"}>{days}d left</Pill>;
}

const COLUMNS: Column<Registration>[] = [
  {
    key: "app",
    header: "Registration",
    render: (r) => (
      <Link href={`/dms/rto/${r.id}`} className="block hover:underline">
        <span className="num block font-medium" style={{ color: "var(--brand-ink)" }}>
          {r.registrationNo ?? r.tpNo}
        </span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {r.customer} · {r.vin}
        </span>
      </Link>
    ),
  },
  { key: "model", header: "Vehicle", secondary: true, render: (r) => `${r.model} · ${r.vehicleClass}` },
  { key: "office", header: "RTO", secondary: true, render: (r) => r.rtoOffice },
  {
    key: "docs",
    header: "Documents",
    align: "right",
    secondary: true,
    render: (r) => `${r.documents.filter((d) => d.ready).length}/${r.documents.length}`,
  },
  { key: "status", header: "Status", render: (r) => <StatusPill value={r.status} /> },
  { key: "tp", header: "TP validity", align: "right", render: (r) => <TpLeft r={r} /> },
];

/**
 * RTO & registration — one file per vehicle, from the temporary registration
 * issued at handover to the RC, with every TP's validity counted down.
 */
export default async function RtoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const statusParam = one(raw.status);
  const status = (STATUSES as readonly string[]).includes(statusParam) ? (statusParam as Registration["status"]) : undefined;

  const { data } = await readMany(["registrations", "bookings"] as const);
  // Searching by booking number finds that booking's vehicles.
  const bookingNo = new Map(data.bookings.map((b) => [b.id, b.bookingNo]));
  const rows = [...data.registrations]
    .map((r) => ({ ...r, bookingNo: bookingNo.get(r.bookingId) ?? "" }))
    .sort((a, b) => Number(registered(a)) - Number(registered(b)) || +new Date(a.tpValidUntil) - +new Date(b.tpValidUntil));
  const shown = filterRows(rows, q).filter((r) => !status || r.status === status);

  const open = rows.filter((r) => !registered(r));
  const expiring = open.filter((r) => daysUntilIso(r.tpValidUntil) <= TP_WARNING_DAYS);
  const lapsed = open.filter((r) => daysUntilIso(r.tpValidUntil) < 0);
  const done30 = rows.filter((r) => r.approvedAt && daysSinceIso(r.approvedAt) <= 30);
  const turnaround = rows
    .filter((r) => r.approvedAt)
    .map((r) => (new Date(r.approvedAt!).getTime() - new Date(r.tpIssuedAt).getTime()) / 86_400_000);

  return (
    <ModuleScreen
      href="/dms/rto"
      exportCollection="registrations"
      searchPlaceholder="Search number, chassis, customer or booking"
      stats={[
        { label: "Awaiting registration", value: String(open.length), hint: `${rows.filter((r) => r.status === "Submitted").length} filed on Vahan` },
        {
          label: `TP lapsing in ${TP_WARNING_DAYS} days`,
          value: String(expiring.length),
          hint: lapsed.length ? `${lapsed.length} already lapsed` : "None lapsed",
          tone: lapsed.length ? "negative" : expiring.length ? "warning" : "neutral",
        },
        { label: "With an objection", value: String(rows.filter((r) => r.status === "Objection").length), hint: "Answer and re-submit", tone: rows.some((r) => r.status === "Objection") ? "warning" : "neutral" },
        {
          label: "Registered, 30 days",
          value: String(done30.length),
          hint: turnaround.length ? `${Math.round(turnaround.reduce((s, d) => s + d, 0) / turnaround.length)} days from TP on average` : "—",
        },
      ]}
      aside={
        <Card>
          <CardHeader title="By RTO office" subtitle="Files still open" />
          <ul className="space-y-2 px-5 pb-5 pt-1">
            {[...new Set(open.map((r) => r.rtoOffice))].sort().map((office) => (
              <li key={office} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <Link href={withParams("/dms/rto", { q: office.split(" ")[0] })} className="hover:underline">
                  {office}
                </Link>
                <span className="num">{open.filter((r) => r.rtoOffice === office).length}</span>
              </li>
            ))}
            {open.length === 0 && (
              <li className="py-3 text-center text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                Every vehicle is registered.
              </li>
            )}
          </ul>
          <p className="px-5 pb-4 text-[11px] leading-snug" style={{ color: "var(--fg-faint)" }}>
            Battery vehicles: RC fee and permit exempt; green plates with yellow characters for commercial use.
          </p>
        </Card>
      }
    >
      <FilterChips
        total={rows.length}
        current={status}
        hrefFor={(value) => withParams("/dms/rto", { q, status: value })}
        options={STATUSES.map((s) => ({ value: s, count: rows.filter((r) => r.status === s).length }))}
      />
      <DataTable rows={shown} columns={COLUMNS} empty={q || status ? "No registration matches those filters." : "No registrations yet — each vehicle gets one at handover."} />
    </ModuleScreen>
  );
}
