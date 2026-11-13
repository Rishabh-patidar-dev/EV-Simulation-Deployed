import type { ComplianceRecord } from "@/server/types";

/** Days before expiry at which a renewal window opens. */
export const RENEWAL_WINDOW_DAYS = 45;

/** A compliance document's status, from its expiry date — never stale. */
export function complianceStatus(expiresOn: string): ComplianceRecord["status"] {
  const days = (new Date(expiresOn).getTime() - Date.now()) / 86_400_000;
  return days < 0 ? "Expired" : days <= RENEWAL_WINDOW_DAYS ? "Expiring Soon" : "Valid";
}

/** Every live dealer is expected to hold one of each. */
export const REQUIRED_DOCUMENTS: ReadonlyArray<ComplianceRecord["docType"]> = ["Trade Licence", "GST Registration", "Dealer Agreement", "Fire NOC", "Shop Insurance"];

/**
 * Lapses that stop a dealer trading with the OEM — no new orders while its
 * dealer agreement or trade licence is expired. Simulation policy.
 */
export const BLOCKING_DOCUMENTS: ReadonlyArray<ComplianceRecord["docType"]> = ["Dealer Agreement", "Trade Licence"];

/** A dealer's compliance file: what is missing, what has lapsed, and whether that blocks orders. */
export function dealerCompliance(dealer: string, records: ComplianceRecord[]) {
  const mine = records.filter((r) => r.dealer === dealer);
  const missing = REQUIRED_DOCUMENTS.filter((t) => !mine.some((r) => r.docType === t));
  const expired = mine.filter((r) => complianceStatus(r.expiresOn) === "Expired");
  const expiring = mine.filter((r) => complianceStatus(r.expiresOn) === "Expiring Soon");
  const valid = mine.filter((r) => complianceStatus(r.expiresOn) !== "Expired").length;
  const blocking = expired.filter((r) => BLOCKING_DOCUMENTS.includes(r.docType));
  return { missing, expired, expiring, score: Math.round((valid / REQUIRED_DOCUMENTS.length) * 100), blocking };
}
