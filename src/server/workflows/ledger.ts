import "server-only";
import { runtimeId } from "../ids";
import { numericRef } from "../numbering";
import { insertRow, readCollection, updateRow } from "../store";
import type { LedgerKey, LedgerMapping, SyncItem } from "../types";

/**
 * The accounting sync. Every invoice, receipt and payout the platform records
 * queues a voucher for the finance system of record; the voucher posts at
 * once when the accounting connector is up, and waits in the queue — or
 * fails with the reason, for replay — when it is not.
 *
 * Simulated: no finance system is called. A voucher "posts" when the
 * connector is connected and every ledger it touches is mapped to a ledger
 * name, which is exactly the failure a real Tally push hits most often.
 */

type VoucherInput = Pick<SyncItem, "voucherType" | "source" | "sourceId" | "reference" | "party" | "amount" | "ledgers">;

const VOUCHER_PREFIX: Record<SyncItem["voucherType"], string> = { Sales: "SV", Receipt: "RV", "Credit Note": "CN" };

/** Tries one voucher against the current mappings and connector; returns the fields to store. */
async function attempt(item: Pick<SyncItem, "voucherType" | "ledgers" | "attempts">): Promise<Partial<SyncItem>> {
  const [{ rows: connectors }, { rows: mappings }] = await Promise.all([readCollection("connectors"), readCollection("ledger_mappings")]);
  const connector = connectors.find((c) => c.key === "accounting");
  if (!connector || connector.status !== "Connected") return { status: "Queued" };

  const unmapped = item.ledgers.filter((key) => !mappings.find((m) => m.key === key)?.ledgerName);
  const now = new Date().toISOString();
  if (unmapped.length) {
    const labels = unmapped.map((key) => mappings.find((m) => m.key === key)?.label ?? key);
    return { status: "Failed", attempts: item.attempts + 1, lastError: `Ledger not mapped: ${labels.join(", ")}` };
  }
  return {
    status: "Synced",
    attempts: item.attempts + 1,
    lastError: null,
    // The finance system's own voucher number, as its API would return it.
    externalRef: `${VOUCHER_PREFIX[item.voucherType]}-${numericRef(8)}`,
    syncedAt: now,
  };
}

export async function queueVoucher(input: VoucherInput): Promise<SyncItem> {
  const base: SyncItem = {
    id: runtimeId("SYNC"),
    ...input,
    status: "Queued",
    attempts: 0,
    lastError: null,
    externalRef: null,
    queuedAt: new Date().toISOString(),
    syncedAt: null,
  };
  const item = { ...base, ...(await attempt(base)) };
  await insertRow("sync_queue", item);
  return item;
}

/** Posts the given queue entries again; returns how many went through. */
export async function replay(items: SyncItem[]): Promise<{ synced: number; failed: number; waiting: number }> {
  let synced = 0;
  let failed = 0;
  let waiting = 0;
  for (const item of items) {
    const outcome = await attempt(item);
    await updateRow("sync_queue", item.id, outcome);
    if (outcome.status === "Synced") synced++;
    else if (outcome.status === "Failed") failed++;
    else waiting++;
  }
  return { synced, failed, waiting };
}

/** The ledgers a sales voucher for this invoice posts to. */
export function salesLedgers(kind: "vehicle" | "parts" | "service", interState: boolean, party: "dealer" | "retail"): LedgerKey[] {
  const sales: LedgerKey = kind === "vehicle" ? "sales_vehicle" : kind === "parts" ? "sales_parts" : "sales_service";
  const tax: LedgerKey[] = interState ? ["output_igst"] : ["output_cgst", "output_sgst"];
  return [party === "dealer" ? "debtors_dealers" : "debtors_retail", sales, ...tax];
}

/**
 * Adds a ledger the chart of accounts did not start with, unmapped — exactly
 * like a new ledger in a real integration: vouchers needing it are refused
 * until someone maps it under ERP / Accounting Integration, then replay.
 */
export async function ensureLedger(ledger: Pick<LedgerMapping, "key" | "label" | "group">): Promise<void> {
  const { rows } = await readCollection("ledger_mappings");
  if (rows.some((m) => m.key === ledger.key)) return;
  await insertRow("ledger_mappings", { id: runtimeId("LEDG"), ...ledger, ledgerName: null, costCentre: null, updatedAt: new Date().toISOString() });
}
