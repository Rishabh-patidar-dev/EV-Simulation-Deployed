"use client";

import { useMemo, useState } from "react";
import { Check, ShieldAlert } from "lucide-react";
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  ROLE_PERMISSIONS,
  USER_ROLES,
  normalizePermissions,
  type Permission,
  type UserRole,
} from "@/lib/permissions";

/**
 * Role picker plus the permission checklist, inside the user's access form.
 * A preset role shows what it grants, read-only; choosing Custom unlocks the
 * checklist. Only a Custom role's checkboxes are submitted (disabled inputs
 * are not), and the server normalises whatever arrives.
 */
export default function PermissionsEditor({ initialRole, initialPermissions }: { initialRole: UserRole; initialPermissions: string[] }) {
  const [role, setRole] = useState<UserRole>(initialRole);
  const [custom, setCustom] = useState<Permission[]>(() =>
    normalizePermissions(initialPermissions.length ? initialPermissions : initialRole === "Custom" ? [] : ROLE_PERMISSIONS[initialRole as Exclude<UserRole, "Custom">])
  );

  const editable = role === "Custom";
  const granted = useMemo(() => new Set<Permission>(editable ? custom : ROLE_PERMISSIONS[role as Exclude<UserRole, "Custom">]), [editable, custom, role]);

  // Ticking "manage" ticks its "view"; unticking a "view" unticks every
  // "manage" that depends on it — the checklist never shows a combination the
  // server would quietly correct.
  const toggle = (permission: Permission) =>
    setCustom((current) =>
      current.includes(permission)
        ? current.filter((p) => p !== permission && !normalizePermissions([p]).includes(permission))
        : normalizePermissions([...current, permission])
    );

  const toggleGroup = (permissions: Permission[], allOn: boolean) =>
    setCustom((current) => {
      const next = new Set(current);
      for (const p of permissions) {
        if (allOn) next.delete(p);
        else next.add(p);
      }
      return normalizePermissions([...next]);
    });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-end">
        <div>
          <label className="field-label" htmlFor="role">
            Role
          </label>
          <select
            id="role"
            name="role"
            className="field"
            value={role}
            onChange={(event) => {
              const next = event.target.value as UserRole;
              // Switching to Custom starts from what the previous preset granted,
              // so tailoring a role is an edit, not a rebuild from nothing.
              if (next === "Custom" && role !== "Custom") setCustom(ROLE_PERMISSIONS[role as Exclude<UserRole, "Custom">]);
              setRole(next);
            }}
          >
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <p className="text-[12px] leading-snug" style={{ color: "var(--fg-muted)" }}>
          {editable ? (
            <>
              <span className="num font-semibold" style={{ color: "var(--fg)" }}>
                {granted.size}
              </span>{" "}
              of {PERMISSIONS.length} permissions selected.
            </>
          ) : (
            <>
              The <strong>{role}</strong> preset grants {granted.size} of {PERMISSIONS.length}. Choose <strong>Custom</strong> to pick them by hand.
            </>
          )}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {PERMISSION_GROUPS.map((group) => {
          const values = group.permissions.map((p) => p.value);
          const allOn = values.every((p) => granted.has(p));
          return (
            <section key={group.group} className="overflow-hidden rounded-[12px]" style={{ border: "1px solid var(--border)" }}>
              <header className="flex items-start justify-between gap-3 px-3.5 py-2.5" style={{ background: "var(--surface-subtle)", borderBottom: "1px solid var(--border)" }}>
                <div className="min-w-0">
                  <h3 className="text-[12.5px] font-semibold">{group.group}</h3>
                  <p className="text-[11.5px] leading-4" style={{ color: "var(--fg-muted)" }}>
                    {group.description}
                  </p>
                </div>
                {editable && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(values, allOn)}
                    className="shrink-0 rounded-[7px] px-2 py-1 text-[11.5px] font-semibold transition-colors hover:bg-[color:var(--hover)]"
                    style={{ color: "var(--brand-ink)" }}
                  >
                    {allOn ? "Clear" : "Select all"}
                  </button>
                )}
              </header>
              <ul>
                {group.permissions.map((permission) => {
                  const checked = granted.has(permission.value);
                  return (
                    <li key={permission.value} style={{ borderTop: "1px solid var(--border)" }} className="first:border-t-0">
                      <label className={`flex items-start gap-3 px-3.5 py-2 ${editable ? "cursor-pointer hover:bg-[color:var(--hover)]" : ""}`}>
                        {editable ? (
                          <input
                            type="checkbox"
                            name="permissions"
                            value={permission.value}
                            checked={checked}
                            onChange={() => toggle(permission.value)}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--brand-ink)]"
                          />
                        ) : (
                          <span
                            aria-hidden
                            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px]"
                            style={checked ? { background: "var(--brand-soft)", color: "var(--brand-ink)" } : { border: "1px solid var(--border-strong)" }}
                          >
                            {checked && <Check className="h-3 w-3" />}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px]" style={checked || editable ? undefined : { color: "var(--fg-faint)" }}>
                            {permission.label}
                            {!editable && <span className="sr-only">{checked ? " — granted" : " — not granted"}</span>}
                          </span>
                          {permission.hint && (
                            <span className="mt-0.5 flex items-center gap-1 text-[11px] leading-4" style={{ color: "var(--fg-muted)" }}>
                              <ShieldAlert className="h-3 w-3 shrink-0" />
                              {permission.hint}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
