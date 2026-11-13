import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Info, TriangleAlert } from "lucide-react";
import PermissionsEditor from "@/components/admin/PermissionsEditor";
import ActionForm from "@/components/ui/ActionForm";
import { MetricTiles, Panel } from "@/components/ui/cards";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatDate, relativeTime } from "@/components/ui/primitives";
import { OPERATOR, initials } from "@/lib/operator";
import { USER_REGIONS, effectivePermissions } from "@/lib/permissions";
import { deleteUser, resendInvite, setUserStatus, updateUserAccess, updateUserProfile } from "@/server/actions/users";
import { readMany } from "@/server/store";

export const dynamic = "force-dynamic";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await readMany(["users", "dealers", "leads"] as const);
  const user = data.users.find((u) => u.id === id);
  if (!user) notFound();

  const isSelf = user.email.toLowerCase() === OPERATOR.email;
  const permissions = effectivePermissions(user);
  const leadsOwned = data.leads.filter((l) => l.assignedTo === user.name);
  const dealerNames = data.dealers.map((d) => d.name).sort();

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="space-y-2">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
          <Link href="/" className="hover:text-[color:var(--fg)]">
            Dashboard
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span>Administration</span>
          <ChevronRight className="h-3 w-3" />
          <Link href="/admin/users" className="hover:text-[color:var(--fg)]">
            User Management
          </Link>
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[15px] font-bold"
            style={user.status === "Deactivated" ? { background: "var(--surface-subtle)", color: "var(--fg-faint)" } : { background: "var(--brand-soft)", color: "var(--brand-ink)" }}
          >
            {initials(user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold leading-tight tracking-tight">{user.name}</h1>
              <StatusPill value={user.status} />
              <Pill tone={user.role === "System Admin" ? "brand" : "neutral"}>{user.role}</Pill>
              {isSelf && <Pill tone="info">You</Pill>}
            </div>
            <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
              {user.email} · {user.region}
              {user.dealer ? ` · ${user.dealer}` : ""}
            </p>
          </div>
        </div>
      </header>

      <div
        className="flex items-start gap-2.5 rounded-[12px] px-4 py-3 text-[12.5px]"
        style={{ background: "var(--info-surface)", border: "1px solid var(--info-border)", color: "var(--fg)" }}
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--info)" }} />
        <p>
          The simulation has no sign-in, so these permissions are recorded to show the access model — they are not yet enforced on any
          screen or request.
        </p>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid min-w-0 gap-4">
          <Panel title="Role & permissions" description="A preset role grants a fixed set; Custom lets you choose exactly what this account can reach.">
            <ActionForm action={updateUserAccess.bind(null, user.id)} className="space-y-4">
              <PermissionsEditor initialRole={user.role} initialPermissions={user.permissions} />
              <div className="flex justify-end">
                <SubmitButton>Save access</SubmitButton>
              </div>
            </ActionForm>
          </Panel>

          <Panel title="Profile" description="How this person appears across the workspace.">
            <ActionForm action={updateUserProfile.bind(null, user.id)} className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="profile-name">
                  Full name
                </label>
                <input id="profile-name" name="name" required maxLength={120} defaultValue={user.name} className="field" />
              </div>
              <div>
                <label className="field-label" htmlFor="profile-email">
                  Work email
                </label>
                <input
                  id="profile-email"
                  name="email"
                  type="email"
                  required
                  maxLength={160}
                  defaultValue={user.email}
                  readOnly={isSelf}
                  title={isSelf ? "Your own sign-in email can only be changed by another administrator" : undefined}
                  className="field"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="profile-phone">
                  Phone
                </label>
                <input id="profile-phone" name="phone" type="tel" maxLength={32} defaultValue={user.phone === "—" ? "" : user.phone} className="field" />
              </div>
              <div>
                <label className="field-label" htmlFor="profile-region">
                  Region
                </label>
                <select id="profile-region" name="region" defaultValue={user.region} className="field">
                  {USER_REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="field-label" htmlFor="profile-dealer">
                  Dealership
                </label>
                <select id="profile-dealer" name="dealer" defaultValue={user.dealer ?? ""} className="field">
                  <option value="">None — OEM staff</option>
                  {dealerNames.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end sm:col-span-2">
                <SubmitButton>Save profile</SubmitButton>
              </div>
            </ActionForm>
          </Panel>
        </div>

        <div className="grid min-w-0 gap-4">
          <Panel title="Activity">
            <MetricTiles
              items={[
                { label: "Permissions", value: `${permissions.length}` },
                { label: "Leads owned", value: `${leadsOwned.length}` },
              ]}
            />
            <dl className="mt-3 space-y-2 text-[12.5px]">
              <Row label="Last active" value={user.lastActiveAt ? relativeTime(user.lastActiveAt) : "Never signed in"} />
              <Row label={user.status === "Invited" ? "Invited" : "Invitation sent"} value={formatDate(user.invitedAt)} />
              <Row label="Account created" value={formatDate(user.createdAt)} />
            </dl>
            {(leadsOwned.length > 0 || user.dealer) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {leadsOwned.length > 0 && (
                  <Link href={`/crm/leads/assigned?q=${encodeURIComponent(user.name)}`} className="btn btn-ghost btn-sm">
                    Their leads <ChevronRight className="h-3 w-3" />
                  </Link>
                )}
                {user.dealer && (
                  <Link href={`/dms/dealers?q=${encodeURIComponent(user.dealer)}`} className="btn btn-ghost btn-sm">
                    Dealership <ChevronRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Access" description="Deactivating keeps every record this person touched; deleting removes the account itself.">
            <div className="space-y-3">
              {user.status === "Invited" && (
                <ActionForm action={resendInvite.bind(null, user.id)} className="flex items-center justify-between gap-3">
                  <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                    Invitation pending since {relativeTime(user.invitedAt)}.
                  </p>
                  <SubmitButton size="sm" tone="ghost">
                    Resend
                  </SubmitButton>
                </ActionForm>
              )}

              {user.status === "Deactivated" ? (
                <ActionForm action={setUserStatus.bind(null, user.id, "Active")} className="flex items-center justify-between gap-3">
                  <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                    Access is revoked.
                  </p>
                  <SubmitButton size="sm">Reactivate</SubmitButton>
                </ActionForm>
              ) : (
                <ActionForm action={setUserStatus.bind(null, user.id, "Deactivated")} className="flex items-center justify-between gap-3">
                  <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                    {isSelf ? "This is your own account." : "Stop this person signing in."}
                  </p>
                  <SubmitButton size="sm" tone="danger">
                    Deactivate
                  </SubmitButton>
                </ActionForm>
              )}

              {/* Delete asks twice: the summary reveals the confirm button. */}
              <details className="disclosure rounded-[12px]" style={{ border: "1px solid var(--negative-border)" }}>
                <summary className="flex items-center gap-2 px-3.5 py-2.5 text-[12.5px] font-semibold" style={{ color: "var(--negative)" }}>
                  <TriangleAlert className="h-4 w-4" />
                  Delete this user…
                </summary>
                <ActionForm action={deleteUser.bind(null, user.id)} className="space-y-2.5 px-3.5 pb-3.5">
                  <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
                    {user.name}&apos;s account is removed for good. Leads and notes they created keep their name.
                  </p>
                  <SubmitButton size="sm" tone="danger">
                    Yes, delete {user.name}
                  </SubmitButton>
                </ActionForm>
              </details>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt style={{ color: "var(--fg-muted)" }}>{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
