import Link from "next/link";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, Pill, StatusPill, relativeTime } from "@/components/ui/primitives";
import { FilterChips, Hint, withParams } from "@/components/ui/workflow";
import { filterRows } from "@/lib/search";
import { SLA, isOpenTicket, slaState } from "@/lib/sla";
import { daysSinceIso } from "@/lib/time";
import { openTicket } from "@/server/actions/support";
import { assignableStaff } from "@/server/staff";
import { readMany } from "@/server/store";
import { TICKET_CATEGORIES, TICKET_CHANNELS, TICKET_PRIORITIES, TICKET_STATUSES, type SupportTicket } from "@/server/types";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function SlaCell({ t }: { t: SupportTicket }) {
  const s = slaState(t);
  if (s.hoursLeft === null) return <span style={{ color: "var(--fg-faint)" }}>{s.resolutionBreached ? "Resolved late" : "Met"}</span>;
  if (s.resolutionBreached) return <Pill tone="negative">Breached {Math.abs(s.hoursLeft)}h</Pill>;
  return <Pill tone={s.hoursLeft < 4 ? "warning" : "neutral"}>{s.hoursLeft}h left</Pill>;
}

const COLUMNS: Column<SupportTicket>[] = [
  {
    key: "ticket",
    header: "Ticket",
    render: (t) => (
      <Link href={`/crm/support/${t.id}`} className="block hover:underline">
        <span className="block font-medium" style={{ color: "var(--brand-ink)" }}>
          {t.subject}
        </span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {t.ticketNo} · {t.customer} · {t.channel}
        </span>
      </Link>
    ),
  },
  { key: "category", header: "Category", secondary: true, render: (t) => t.category },
  { key: "priority", header: "Priority", render: (t) => <Pill tone={t.priority === "P1" ? "negative" : t.priority === "P2" ? "warning" : "neutral"}>{t.priority}</Pill> },
  { key: "assignee", header: "With", secondary: true, render: (t) => t.escalatedTo ?? t.assignee },
  { key: "status", header: "Status", render: (t) => <StatusPill value={t.status} /> },
  { key: "sla", header: "SLA", align: "right", render: (t) => <SlaCell t={t} /> },
  { key: "opened", header: "Opened", align: "right", secondary: true, render: (t) => <span className="whitespace-nowrap">{relativeTime(t.openedAt)}</span> },
];

/**
 * Customer support & ticketing — the phone line, WhatsApp, email and the
 * website's support form in one queue, worked against priority SLAs.
 */
export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const statusParam = one(raw.status);
  const status = (TICKET_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as SupportTicket["status"]) : undefined;

  const [{ data }, agents] = await Promise.all([readMany(["tickets", "dealers"] as const), assignableStaff("support.manage")]);
  // Open tickets by how close they are to breaching, then the rest newest first.
  const rows = [...data.tickets].sort((a, b) => {
    const ao = isOpenTicket(a) ? 0 : 1;
    const bo = isOpenTicket(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return ao === 0 ? +new Date(a.resolveBy) - +new Date(b.resolveBy) : +new Date(b.openedAt) - +new Date(a.openedAt);
  });
  const shown = filterRows(rows, q).filter((t) => !status || t.status === status);
  const open = rows.filter(isOpenTicket);
  const breached = open.filter((t) => slaState(t).resolutionBreached);
  const resolved30 = rows.filter((t) => t.resolvedAt && daysSinceIso(t.resolvedAt) <= 30);
  const onTime = resolved30.filter((t) => !slaState(t).resolutionBreached);
  const rated = rows.filter((t) => t.csat !== null);

  return (
    <ModuleScreen
      href="/crm/support"
      exportCollection="tickets"
      searchPlaceholder="Search tickets, customers or VIN"
      stats={[
        { label: "Open tickets", value: String(open.length), hint: `${open.filter((t) => t.priority === "P1").length} with a vehicle off the road` },
        { label: "SLA breached", value: String(breached.length), hint: "Open and past the resolve-by time", tone: breached.length ? "negative" : "neutral" },
        { label: "Resolved on time", value: resolved30.length ? `${Math.round((onTime.length / resolved30.length) * 100)}%` : "—", hint: `${resolved30.length} resolved in 30 days` },
        { label: "CSAT", value: rated.length ? `${(rated.reduce((s, t) => s + (t.csat ?? 0), 0) / rated.length).toFixed(1)} / 5` : "—", hint: `${rated.length} ratings` },
      ]}
      toolbar={
        <Disclosure label="Log a ticket" open={one(raw.new) === "1"}>
          <ActionForm action={openTicket} resetOnSuccess className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input name="customer" required maxLength={120} className="field" placeholder="Customer name" aria-label="Customer" />
              <input name="phone" required inputMode="tel" className="field" placeholder="Mobile" aria-label="Mobile" />
              <input name="city" maxLength={60} className="field" placeholder="City" aria-label="City" />
              <select name="channel" className="field" defaultValue="Phone" aria-label="Channel">
                {TICKET_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select name="category" required className="field" defaultValue="" aria-label="Category">
                <option value="" disabled>
                  What is it about?
                </option>
                {TICKET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select name="priority" className="field" defaultValue="P3" aria-label="Priority">
                {TICKET_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p} — {SLA[p].label} ({SLA[p].resolveHours}h)
                  </option>
                ))}
              </select>
              <input name="vin" maxLength={20} className="field num uppercase" placeholder="Chassis or registration (optional)" aria-label="Vehicle" />
              <select name="assignee" className="field" aria-label="Assign to">
                {agents.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <select name="dealer" className="field sm:col-span-2" defaultValue="" aria-label="Dealer">
                <option value="">Dealer — found from the vehicle if blank</option>
                {data.dealers.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
              <input name="subject" required maxLength={140} className="field sm:col-span-2" placeholder="Subject" aria-label="Subject" />
              <textarea name="description" required maxLength={2000} rows={3} className="field sm:col-span-2 lg:col-span-4" placeholder="The problem, in the customer's words" aria-label="Description" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton>Log ticket</SubmitButton>
              <Hint>The customer gets the ticket number on WhatsApp with the response time for its priority.</Hint>
            </div>
          </ActionForm>
        </Disclosure>
      }
      aside={
        <Card>
          <CardHeader title="SLA by priority" subtitle="First response · resolution" />
          <ul className="space-y-2 px-5 pb-5 pt-1">
            {TICKET_PRIORITIES.map((p) => {
              const theirs = open.filter((t) => t.priority === p);
              return (
                <li key={p} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="min-w-0">
                    <span className="font-semibold">{p}</span> <span style={{ color: "var(--fg-muted)" }}>{SLA[p].label}</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap" style={{ color: "var(--fg-muted)" }}>
                    {SLA[p].respondHours}h · {SLA[p].resolveHours}h · <span className="num">{theirs.length}</span> open
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="px-5 pb-4 text-[11px] leading-snug" style={{ color: "var(--fg-faint)" }}>
            Support line +91 92019 87203, Mon–Sat 9–6 · info@luxusgreen.com.
          </p>
        </Card>
      }
    >
      <FilterChips
        total={rows.length}
        current={status}
        hrefFor={(value) => withParams("/crm/support", { q, status: value })}
        options={TICKET_STATUSES.map((s) => ({ value: s, count: rows.filter((t) => t.status === s).length }))}
      />
      <DataTable rows={shown} columns={COLUMNS} empty={q || status ? "No ticket matches those filters." : "No tickets yet."} />
    </ModuleScreen>
  );
}
