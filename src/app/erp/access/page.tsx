import Link from "next/link";
import { UserCog } from "lucide-react";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, Pill, StatusPill, relativeTime } from "@/components/ui/primitives";
import { MODULE_COUNT } from "@/lib/modules";
import { filterRows, readQuery } from "@/lib/search";
import { hoursSince } from "@/lib/time";
import { decideApproval } from "@/server/actions/approvals";
import { readCollection } from "@/server/store";
import type { Approval, RoleRecord } from "@/server/types";

export const dynamic = "force-dynamic";

const ROLE_COLUMNS: Column<RoleRecord>[] = [
  {
    key: "role",
    header: "Role",
    render: (r) => (
      <Link href={`/admin/users?role=${encodeURIComponent(r.role)}`} className="font-medium hover:underline" style={{ color: "var(--brand-ink)" }}>
        {r.role}
      </Link>
    ),
  },
  { key: "users", header: "Users", align: "right", render: (r) => r.users },
  { key: "scope", header: "Data scope", render: (r) => r.scope },
  { key: "modules", header: "Modules", align: "right", render: (r) => `${r.modules} / ${MODULE_COUNT}`, secondary: true },
  { key: "approve", header: "Can approve", render: (r) => <Pill tone="brand">{r.canApprove}</Pill>, secondary: true },
];

/** Where a request points, when deciding it changes a record. */
function linkFor(a: Approval): { href: string; label: string } | null {
  if (a.link?.kind === "quotation") return { href: `/dms/quotations/${a.link.id}`, label: "Open the quotation" };
  if (a.link?.kind === "application") return { href: `/dms/onboarding/${a.link.id}`, label: "Open the application" };
  if (a.link?.kind === "order") return { href: `/dms/orders/${a.link.id}`, label: "Open the order" };
  if (a.link?.kind === "warranty_claim") return { href: `/dms/service/warranty/${a.link.id}`, label: "Open the claim" };
  return null;
}

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [roles, approvals, users, q] = await Promise.all([
    readCollection("roles"),
    readCollection("approvals"),
    readCollection("users"),
    readQuery(searchParams),
  ]);
  // Headcount is counted from User Management, never stored — the two
  // screens cannot disagree about who holds which role.
  const withCounts = roles.rows.map((r) => ({ ...r, users: users.rows.filter((u) => u.role === r.role && u.status !== "Deactivated").length }));
  const shown = filterRows(withCounts, q);

  // Oldest first — an approval queue is read by age, not by type. Age is
  // measured from when it was raised, so it keeps counting.
  const pending: Approval[] = approvals.rows
    .filter((a) => (a.status ?? "Pending") === "Pending")
    .sort((a, b) => +new Date(a.raisedAt) - +new Date(b.raisedAt));
  const decided = approvals.rows
    .filter((a) => a.status && a.status !== "Pending")
    .sort((a, b) => +new Date(b.decidedAt ?? b.raisedAt) - +new Date(a.decidedAt ?? a.raisedAt));
  const oldestHours = pending.length ? Math.round(hoursSince(pending[0].raisedAt)) : 0;

  return (
    <ModuleScreen
      href="/erp/access"
      searchPlaceholder="Search roles"
      exportCollection="approvals"
      actions={
        <Link href="/admin/users" className="btn btn-ghost">
          <UserCog className="h-3.5 w-3.5" />
          Manage users
        </Link>
      }
      stats={[
        { label: "Roles defined", value: String(roles.rows.length), hint: `${shown.length} shown` },
        { label: "Users", value: String(users.rows.filter((u) => u.status !== "Deactivated").length), hint: "Active and invited, every role" },
        { label: "Approvals pending", value: String(pending.length), hint: "Waiting on a decision", tone: pending.length ? "warning" : "neutral" },
        {
          label: "Oldest approval",
          value: pending.length ? (oldestHours >= 48 ? `${Math.floor(oldestHours / 24)}d` : `${oldestHours}h`) : "—",
          hint: pending.length ? `with ${pending[0].pendingWith}` : "Queue is clear",
          tone: oldestHours > 48 ? "negative" : "neutral",
        },
      ]}
      toolbar={
        <section id="approvals" className="surface overflow-hidden" aria-label="Approval queue">
          <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <h2 className="text-[14px] font-semibold">Approval queue</h2>
            <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
              Oldest first. A decision on a discount or a warranty claim carries straight through to the record.
            </p>
          </header>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {pending.map((a) => {
              const hours = hoursSince(a.raisedAt);
              const link = linkFor(a);
              return (
                <li key={a.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_24rem]" style={{ borderColor: "var(--border)" }}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={hours > 48 ? "negative" : "info"}>{a.type}</Pill>
                      <span className="font-medium">{a.subject}</span>
                    </div>
                    {a.detail && <p className="mt-1 text-[12.5px]">{a.detail}</p>}
                    <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                      {a.requestedBy} → {a.pendingWith} · raised {relativeTime(a.raisedAt)}
                      {link && (
                        <>
                          {" · "}
                          <Link href={link.href} className="underline">
                            {link.label}
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <ActionForm action={decideApproval.bind(null, a.id)} className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <input name="note" maxLength={300} className="field min-w-0 flex-1 py-1.5! text-[12px]" placeholder="Note (required to reject)" aria-label={`Note on ${a.subject}`} />
                    <SubmitButton size="sm" name="decision" value="Approved">
                      Approve
                    </SubmitButton>
                    <SubmitButton size="sm" tone="danger" name="decision" value="Rejected">
                      Reject
                    </SubmitButton>
                  </ActionForm>
                </li>
              );
            })}
            {pending.length === 0 && (
              <li className="px-4 py-6 text-center text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                Nothing waiting for approval.
              </li>
            )}
          </ul>
        </section>
      }
      aside={
        <Card>
          <CardHeader title="Recently decided" subtitle="Newest first" />
          <ul className="space-y-3 px-5 pb-5 pt-1">
            {decided.slice(0, 8).map((a) => (
              <li key={a.id} className="min-w-0">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] font-medium">
                    {a.type} — {a.subject}
                  </span>
                  <StatusPill value={a.status ?? "Pending"} />
                </span>
                <span className="block truncate text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                  {a.decidedBy ?? "—"}
                  {a.decidedAt ? ` · ${relativeTime(a.decidedAt)}` : ""}
                  {a.note ? ` · “${a.note}”` : ""}
                </span>
              </li>
            ))}
            {decided.length === 0 && (
              <li className="py-4 text-center text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                No decisions yet.
              </li>
            )}
          </ul>
        </Card>
      }
    >
      <DataTable rows={shown} columns={ROLE_COLUMNS} empty="No roles match that search." />
    </ModuleScreen>
  );
}
