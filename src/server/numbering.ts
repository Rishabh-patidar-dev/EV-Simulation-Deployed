import "server-only";
import { createHash } from "node:crypto";

/**
 * Document numbers: `PREFIX/YY/NNNN`, one past the highest number already in
 * the series (whatever year it was issued in), so numbers never repeat.
 */
export function nextNumber(existing: readonly string[], prefix: string, floor = 1000): string {
  const highest = existing.reduce((max, value) => {
    if (!value?.startsWith(`${prefix}/`)) return max;
    const n = Number(value.split("/").pop());
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, floor);
  return `${prefix}/${String(new Date().getFullYear()).slice(-2)}/${highest + 1}`;
}

/**
 * A number series to draw several numbers from in one action — reads are
 * cached for the length of a request, so re-reading after an insert would
 * hand out the same number twice.
 */
export function numberSeries(existing: readonly string[], prefix: string, floor = 1000): () => string {
  const taken = [...existing];
  return () => {
    const next = nextNumber(taken, prefix, floor);
    taken.push(next);
    return next;
  };
}

/** Indian financial year of a date — "2026-27" for anything from April 2026 to March 2027. */
function financialYear(at = new Date()): string {
  const start = at.getMonth() >= 3 ? at.getFullYear() : at.getFullYear() - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

/**
 * The IRP's invoice reference number is a SHA-256 over the seller's GSTIN,
 * the financial year, the document type and number — computed the same way
 * here, so a simulated e-invoice carries a well-formed 64-character IRN.
 */
export function invoiceReferenceNumber(sellerGstin: string, invoiceNo: string, at = new Date()): string {
  return createHash("sha256").update(`${sellerGstin}${financialYear(at)}INV${invoiceNo}`).digest("hex");
}

/** A numeric reference of the given length: the clock, then four random digits, so two in the same millisecond differ. */
export function numericRef(length: number): string {
  const random = Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join("");
  return `${Date.now()}${random}`.slice(-length).padStart(length, "0");
}

/** An upper-case alphanumeric reference, e.g. a gate pass or a gateway id. */
export function alphaRef(length: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
