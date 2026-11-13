import "server-only";
import { revalidatePath } from "next/cache";
import { failed, type ActionResult } from "@/lib/actions";

/**
 * Reading a submitted form without trusting it. Every server action is a
 * public POST endpoint — callable directly, not only through its form — so
 * fields and bound ids alike are checked here before anything is written.
 */

export type Prev = ActionResult | null;

/** Ids from the original data (`LEAD-0001`) and from runtime (`LEAD-M1X2AB3C`) both fit. */
export const isId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);

/** Trimmed and length-capped. */
export const str = (fd: FormData, key: string, max = 200) => String(fd.get(key) ?? "").trim().slice(0, max);

/** A number within bounds, or null when it is missing or not a number. */
export function num(fd: FormData, key: string, min: number, max: number): number | null {
  const raw = str(fd, key, 40);
  if (raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

/** A whole number within bounds, or null. */
export function int(fd: FormData, key: string, min: number, max: number): number | null {
  const value = num(fd, key, min, max);
  return value !== null && Number.isInteger(value) ? value : null;
}

/** The field's value if it is one of `allowed`, otherwise null — never an arbitrary string cast to the union. */
export function oneOf<T extends string>(fd: FormData, key: string, allowed: readonly T[]): T | null {
  const value = str(fd, key);
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * ISO timestamp for a date or datetime field, or null when missing or not a
 * real date. A `datetime-local` value carries no zone; the business runs on
 * India time, so it is read as IST whatever the server's own zone is.
 */
export function dateField(fd: FormData, key: string): string | null {
  const value = str(fd, key, 40);
  if (!value) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value) ? `${value}+05:30` : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Checkbox fields sharing one name, as the set of values that were ticked. */
export const ticked = (fd: FormData, key: string) => new Set(fd.getAll(key).map(String));

export const gone = (what: string) => failed(`That ${what} no longer exists`, "Someone may have removed it — refresh to see the current state.");

/**
 * Every screen is rendered per request, so one call refreshes whatever the
 * browser is showing — including the bell and the dashboard, which read
 * across modules.
 */
export function refresh() {
  revalidatePath("/", "layout");
}

/** An Indian mobile number, normalised to "+91 98765 43210", or null. */
export function phoneField(fd: FormData, key: string): string | null {
  const digits = str(fd, key, 20).replace(/[^\d]/g, "").replace(/^91(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : null;
}
