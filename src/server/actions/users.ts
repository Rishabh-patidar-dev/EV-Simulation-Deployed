"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { OPERATOR } from "@/lib/operator";
import { USER_REGIONS, USER_ROLES, normalizePermissions, type UserRole } from "@/lib/permissions";
import { runtimeId } from "../ids";
import { deleteRow, insertRow, readCollection, updateRow } from "../store";
import type { AppUser } from "../types";
import { saving } from "./outcome";

/**
 * Every User Management write. Like the CRM actions, each is a public POST
 * endpoint, so nothing it receives is trusted; unlike them, each reports what
 * happened, because "that email is already taken" is something the person at
 * the form needs to hear.
 *
 * Two guards mirror what a real admin console enforces: the account the demo
 * is signed in as cannot remove its own access, and the last active System
 * Admin cannot be demoted, deactivated or deleted. A database refusal comes
 * back as "not saved" (see ./outcome) rather than an error page.
 */

const MAX_TEXT = 120;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const isId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9-]{1,64}$/.test(value);
const str = (fd: FormData, key: string, max = MAX_TEXT) => String(fd.get(key) ?? "").trim().slice(0, max);

function oneOf<T extends string>(fd: FormData, key: string, allowed: readonly T[]): T | null {
  const v = str(fd, key);
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function touch(userId?: string) {
  for (const path of ["/admin/users", "/erp/access", "/"]) revalidatePath(path);
  if (userId) revalidatePath(`/admin/users/${userId}`);
}

/** Active System Admins other than `exceptId`. */
const otherActiveAdmins = (users: AppUser[], exceptId: string) =>
  users.filter((u) => u.id !== exceptId && u.role === "System Admin" && u.status === "Active").length;

const isOperator = (user: AppUser) => user.email.toLowerCase() === OPERATOR.email;

async function loadUser(userId: string) {
  const { rows } = await readCollection("users");
  return { users: rows, user: rows.find((u) => u.id === userId) ?? null };
}

/** Profile fields shared by invite and edit; returns an error message or the cleaned values. */
async function readProfile(fd: FormData, users: AppUser[], selfId: string | null) {
  const name = str(fd, "name");
  const email = str(fd, "email", 160).toLowerCase();
  const phone = str(fd, "phone", 32);
  const region = oneOf(fd, "region", USER_REGIONS);
  const dealer = str(fd, "dealer") || null;

  if (!name) return { error: "A name is required" } as const;
  if (!EMAIL.test(email)) return { error: "That email address does not look right", description: email || undefined } as const;
  if (users.some((u) => u.id !== selfId && u.email.toLowerCase() === email)) {
    return { error: "That email is already in use", description: `${email} belongs to another account.` } as const;
  }
  if (!region) return { error: "Choose a region" } as const;

  if (dealer) {
    const { rows: dealers } = await readCollection("dealers");
    if (!dealers.some((d) => d.name === dealer)) return { error: "Unknown dealership", description: dealer } as const;
  }

  return { value: { name, email, phone: phone || "—", region, dealer } } as const;
}

// ---------------------------------------------------------------------------

export async function inviteUser(_state: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const { rows: users } = await readCollection("users");
    const profile = await readProfile(fd, users, null);
    if ("error" in profile) return failed(profile.error!, profile.description);

    const role = oneOf(fd, "role", USER_ROLES);
    if (!role) return failed("Choose a role");
    if (role === "Dealer Principal" && !profile.value.dealer) {
      return failed("Pick the dealership", "A Dealer Principal belongs to one dealership.");
    }

    const now = new Date().toISOString();
    const user: AppUser = {
      id: runtimeId("USR"),
      ...profile.value,
      role,
      status: "Invited",
      // A Custom account starts with the least useful thing — view leads — and
      // gets its real permissions on its own page.
      permissions: role === "Custom" ? ["leads.view"] : [],
      lastActiveAt: null,
      invitedAt: now,
      createdAt: now,
    };

    await insertRow("users", user);
    touch();
    return succeeded(`Invitation sent to ${user.name}`, role === "Custom" ? "Open their page to choose permissions." : `${user.email} · ${role}`);
  });
}

export async function updateUserProfile(userId: string, _state: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(userId)) return failed("Unknown user");
    const { users, user } = await loadUser(userId);
    if (!user) return failed("That user no longer exists");

    const profile = await readProfile(fd, users, userId);
    if ("error" in profile) return failed(profile.error!, profile.description);
    if (isOperator(user) && profile.value.email !== user.email) {
      return failed("You can't change your own sign-in email here", "Ask another administrator to do it.");
    }

    await updateRow("users", userId, profile.value);
    touch(userId);
    return succeeded("Profile saved", profile.value.name);
  });
}

export async function updateUserAccess(userId: string, _state: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(userId)) return failed("Unknown user");
    const { users, user } = await loadUser(userId);
    if (!user) return failed("That user no longer exists");

    const role = oneOf(fd, "role", USER_ROLES) as UserRole | null;
    if (!role) return failed("Choose a role");

    if (user.role === "System Admin" && role !== "System Admin") {
      if (isOperator(user)) return failed("You can't remove your own admin role");
      if (user.status === "Active" && otherActiveAdmins(users, userId) === 0) {
        return failed("This is the last active System Admin", "Make someone else an admin first.");
      }
    }

    const permissions = role === "Custom" ? normalizePermissions(fd.getAll("permissions")) : [];
    if (role === "Custom" && permissions.length === 0) return failed("Pick at least one permission", "A Custom role with nothing selected could not do anything.");

    await updateRow("users", userId, { role, permissions });
    touch(userId);
    return succeeded("Access updated", role === "Custom" ? `${permissions.length} permissions on a Custom role` : `Now ${role}`);
  });
}

export async function setUserStatus(userId: string, status: "Active" | "Deactivated"): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(userId) || (status !== "Active" && status !== "Deactivated")) return failed("Unknown request");
    const { users, user } = await loadUser(userId);
    if (!user) return failed("That user no longer exists");

    if (status === "Deactivated") {
      if (isOperator(user)) return failed("You can't deactivate your own account");
      if (user.role === "System Admin" && user.status === "Active" && otherActiveAdmins(users, userId) === 0) {
        return failed("This is the last active System Admin", "Make someone else an admin first.");
      }
    }

    await updateRow("users", userId, {
      status,
      // Reactivating an account that never accepted its invitation leaves it invited.
      ...(status === "Active" && !user.lastActiveAt ? { status: "Invited" as const } : {}),
    });
    touch(userId);
    return status === "Deactivated"
      ? succeeded(`${user.name} deactivated`, "They can no longer sign in. Their records stay as they are.")
      : succeeded(`${user.name} reactivated`, user.lastActiveAt ? "They can sign in again." : "Their invitation is open again.");
  });
}

export async function resendInvite(userId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(userId)) return failed("Unknown user");
    const { user } = await loadUser(userId);
    if (!user) return failed("That user no longer exists");
    if (user.status !== "Invited") return failed("Only a pending invitation can be resent");

    await updateRow("users", userId, { invitedAt: new Date().toISOString() });
    touch(userId);
    return succeeded("Invitation resent", `A fresh link went to ${user.email} (simulated — no email leaves the demo).`);
  });
}

export async function deleteUser(userId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(userId)) return failed("Unknown user");
    const { users, user } = await loadUser(userId);
    if (!user) return failed("That user no longer exists");
    if (isOperator(user)) return failed("You can't delete your own account");
    if (user.role === "System Admin" && user.status === "Active" && otherActiveAdmins(users, userId) === 0) {
      return failed("This is the last active System Admin", "Make someone else an admin first.");
    }

    await deleteRow("users", userId);
    touch();
    redirect(`/admin/users?deleted=${encodeURIComponent(user.name)}`);
  });
}
