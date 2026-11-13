import Link from "next/link";
import { X } from "lucide-react";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Disclosure from "@/components/ui/Disclosure";
import FlashToast from "@/components/ui/FlashToast";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, Pill, StatusPill, relativeTime } from "@/components/ui/primitives";
import { initials } from "@/lib/operator";
import { USER_REGIONS, USER_ROLES, USER_STATUSES, type UserRole, type UserStatus } from "@/lib/permissions";
import { filterRows } from "@/lib/search";
import { inviteUser, resendInvite } from "@/server/actions/users";
import { readMany } from "@/server/store";
import type { AppUser } from "@/server/types";

export const dynamic = "force-dynamic";

type Params = { q?: string; role?: string; status?: string; new?: string; deleted?: string };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** A link to this page with some filters changed and the rest kept. */
function hrefWith(params: Params, patch: Partial<Record<"q" | "role" | "status", string | undefined>>) {
  const next = new URLSearchParams();
  const merged = { q: params.q, role: params.role, status: params.status, ...patch };
  for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
  const query = next.toString();
  return query ? `/admin/users?${query}` : "/admin/users";
}

const COLUMNS: Column<AppUser>[] = [
  {
    key: "user",
    header: "User",
    render: (u) => (
      <Link href={`/admin/users/${u.id}`} className="flex min-w-0 items-center gap-2.5 hover:underline">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
          style={u.status === "Deactivated" ? { background: "var(--surface-subtle)", color: "var(--fg-faint)" } : { background: "var(--brand-soft)", color: "var(--brand-ink)" }}
        >
          {initials(u.name)}
        </span>
        <span className="min-w-0 max-w-[15rem]">
          <span className="block truncate font-medium" style={{ color: "var(--brand-ink)" }}>
            {u.name}
          </span>
          <span className="block truncate text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
            {u.email}
          </span>
        </span>
      </Link>
    ),
  },
  { key: "role", header: "Role", render: (u) => <Pill tone={u.role === "System Admin" ? "brand" : "neutral"}>{u.role}</Pill> },
  {
    key: "territory",
    header: "Territory",
    secondary: true,
    render: (u) => (
      <span className="block whitespace-nowrap">
        <span className="block">{u.region}</span>
        {u.dealer && (
          <span className="block max-w-[10rem] truncate text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
            {u.dealer}
          </span>
        )}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (u) => (
      <span className="block whitespace-nowrap">
        <StatusPill value={u.status} />
        <span className="mt-1 block text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
          {u.lastActiveAt ? `Last seen ${relativeTime(u.lastActiveAt)}` : "Never signed in"}
        </span>
      </span>
    ),
  },
];

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params: Params = { q: one(raw.q), role: one(raw.role), status: one(raw.status), new: one(raw.new), deleted: one(raw.deleted) };
  const role = (USER_ROLES as readonly string[]).includes(params.role ?? "") ? (params.role as UserRole) : undefined;
  const status = (USER_STATUSES as readonly string[]).includes(params.status ?? "") ? (params.status as UserStatus) : undefined;

  const { data } = await readMany(["users", "dealers"] as const);
  const users = data.users;
  const dealerNames = data.dealers.map((d) => d.name).sort();

  const shown = filterRows(users, params.q).filter((u) => (!role || u.role === role) && (!status || u.status === status));
  const byStatus = (s: UserStatus) => users.filter((u) => u.status === s).length;
  const invited = users.filter((u) => u.status === "Invited").sort((a, b) => +new Date(a.invitedAt) - +new Date(b.invitedAt));

  return (
    <ModuleScreen
      href="/admin/users"
      exportCollection="users"
      searchPlaceholder="Search name, email, dealer"
      stats={[
        { label: "Users", value: String(users.length), hint: `${shown.length} shown` },
        { label: "Active", value: String(byStatus("Active")), hint: "Signed in and working" },
        { label: "Invited", value: String(byStatus("Invited")), hint: "Waiting for first sign-in", tone: byStatus("Invited") ? "info" : "neutral" },
        { label: "Deactivated", value: String(byStatus("Deactivated")), hint: "Access revoked, history kept" },
      ]}
      toolbar={
        <Disclosure label="Invite user" open={params.new === "1"}>
          <ActionForm action={inviteUser} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="field-label" htmlFor="invite-name">
                Full name
              </label>
              <input id="invite-name" name="name" required maxLength={120} className="field" placeholder="e.g. Kavya Iyer" />
            </div>
            <div>
              <label className="field-label" htmlFor="invite-email">
                Work email
              </label>
              <input id="invite-email" name="email" type="email" required maxLength={160} className="field" placeholder="name@luxusgreen.example" />
            </div>
            <div>
              <label className="field-label" htmlFor="invite-phone">
                Phone (optional)
              </label>
              <input id="invite-phone" name="phone" type="tel" maxLength={32} className="field" placeholder="+91 90000 00000" />
            </div>
            <div>
              <label className="field-label" htmlFor="invite-role">
                Role
              </label>
              <select id="invite-role" name="role" className="field" defaultValue="Sales Executive">
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="invite-region">
                Region
              </label>
              <select id="invite-region" name="region" className="field" defaultValue="West">
                {USER_REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="invite-dealer">
                Dealership (dealer staff only)
              </label>
              <select id="invite-dealer" name="dealer" className="field" defaultValue="">
                <option value="">None — OEM staff</option>
                {dealerNames.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
              <SubmitButton>Send invitation</SubmitButton>
              <p className="text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                The account starts as Invited. Choose Custom to set permissions on the user&apos;s page afterwards.
              </p>
            </div>
          </ActionForm>
        </Disclosure>
      }
      aside={
        <>
          <Card>
            <CardHeader title="By role" subtitle="Headcount per role — select one to filter" />
            <ul className="px-3 pb-4">
              {USER_ROLES.map((r) => {
                const count = users.filter((u) => u.role === r).length;
                const selected = role === r;
                return (
                  <li key={r}>
                    <Link
                      href={hrefWith(params, { role: selected ? undefined : r })}
                      aria-current={selected ? "true" : undefined}
                      className="flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-[12.5px] transition-colors hover:bg-[color:var(--hover)]"
                      style={selected ? { background: "var(--brand-soft)", color: "var(--brand-ink)", fontWeight: 600 } : undefined}
                    >
                      <span className="min-w-0 flex-1 truncate">{r}</span>
                      <span className="num shrink-0 font-semibold">{count}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Pending invitations" subtitle="Oldest first" />
            <ul className="space-y-2.5 px-5 pb-5 pt-1">
              {invited.slice(0, 6).map((u) => (
                <li key={u.id} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <Link href={`/admin/users/${u.id}`} className="block truncate text-[12.5px] font-medium hover:underline">
                      {u.name}
                    </Link>
                    <span className="block truncate text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
                      {u.role} · invited {relativeTime(u.invitedAt)}
                    </span>
                  </span>
                  <ActionForm action={resendInvite.bind(null, u.id)}>
                    <SubmitButton size="sm" tone="ghost">
                      Resend
                    </SubmitButton>
                  </ActionForm>
                </li>
              ))}
              {invited.length === 0 && (
                <li className="py-3 text-center text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                  Every invitation has been accepted.
                </li>
              )}
            </ul>
          </Card>
        </>
      }
    >
      {/* The name rides in the URL after a delete redirect; capped so a crafted link cannot turn the toast into a paragraph. */}
      {params.deleted && <FlashToast param="deleted" message={`${params.deleted.slice(0, 80)} was removed`} />}

      <div className="flex flex-wrap items-center gap-1.5 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
        {([undefined, ...USER_STATUSES] as const).map((s) => {
          const selected = status === s;
          const count = s ? byStatus(s) : users.length;
          return (
            <Link
              key={s ?? "all"}
              href={hrefWith(params, { status: s })}
              aria-current={selected ? "true" : undefined}
              className="rounded-full px-3 py-1 text-[12px] font-medium transition-colors"
              style={
                selected
                  ? { background: "var(--brand-soft)", color: "var(--brand-ink)", border: "1px solid color-mix(in srgb, var(--brand) 35%, transparent)" }
                  : { border: "1px solid var(--border)", color: "var(--fg-muted)" }
              }
            >
              {s ?? "All"} <span className="num opacity-70">{count}</span>
            </Link>
          );
        })}

        {role && (
          <Link
            href={hrefWith(params, { role: undefined })}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium"
            style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}
            aria-label={`Remove role filter ${role}`}
          >
            Role: {role}
            <X className="h-3 w-3" />
          </Link>
        )}
      </div>

      <DataTable
        rows={shown}
        columns={COLUMNS}
        empty={params.q || role || status ? "No user matches those filters." : "No users yet — invite the first one above."}
      />
    </ModuleScreen>
  );
}
