import "server-only";
import { effectivePermissions, type Permission } from "@/lib/permissions";
import { readCollection } from "./store";

/**
 * Who work can be assigned to: active internal users (not dealer-side
 * logins) whose access covers the job, by name, A–Z. Read from the users
 * table, so someone added in User Management shows up in every "assign to"
 * list once active, and someone deactivated drops out of them. The same list
 * both fills the dropdown and validates what comes back from it.
 */
export async function assignableStaff(permission: Permission): Promise<string[]> {
  const { rows } = await readCollection("users");
  const names = rows.filter((u) => u.status === "Active" && !u.dealer && effectivePermissions(u).includes(permission)).map((u) => u.name);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
