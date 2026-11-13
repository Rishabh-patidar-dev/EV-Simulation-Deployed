"use server";

import { ACCOUNTING_SYSTEMS } from "@/lib/accounting";
import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { readMany, updateRow } from "../store";
import { replay } from "../workflows/ledger";
import { gone, isId, oneOf, refresh, str, type Prev } from "./input";
import { saving } from "./outcome";

/**
 * ERP / accounting integration — the sync queue, the ledger mapping and the
 * finance system it posts to. Posting is simulated (see workflows/ledger.ts):
 * a voucher goes through when the connector is up and every ledger it touches
 * is mapped, which is exactly where a real Tally push fails most often.
 */

function summary(r: { synced: number; failed: number; waiting: number }): string {
  return [r.synced && `${r.synced} posted`, r.failed && `${r.failed} failed`, r.waiting && `${r.waiting} still queued (connector down)`].filter(Boolean).join(" · ") || "Nothing to post";
}

export async function syncQueued(): Promise<ActionResult> {
  return saving(async () => {
    const { data } = await readMany(["sync_queue"] as const);
    const queued = data.sync_queue.filter((q) => q.status === "Queued");
    if (!queued.length) return succeeded("The queue is empty");
    const r = await replay(queued);
    refresh();
    return r.synced ? succeeded("Sync run", summary(r)) : failed("Nothing posted", summary(r));
  });
}

export async function replayFailed(): Promise<ActionResult> {
  return saving(async () => {
    const { data } = await readMany(["sync_queue"] as const);
    const failures = data.sync_queue.filter((q) => q.status === "Failed");
    if (!failures.length) return succeeded("No failed vouchers");
    const r = await replay(failures);
    refresh();
    return r.synced ? succeeded("Failed vouchers replayed", summary(r)) : failed("Still failing", summary(r) + " — check the ledger mapping.");
  });
}

export async function replayOne(itemId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(itemId)) return gone("voucher");
    const { data } = await readMany(["sync_queue"] as const);
    const item = data.sync_queue.find((q) => q.id === itemId);
    if (!item) return gone("voucher");
    if (item.status === "Synced") return failed("Already posted", item.externalRef ?? undefined);
    const r = await replay([item]);
    refresh();
    return r.synced ? succeeded(`${item.reference} posted`) : failed(`${item.reference} did not post`, summary(r));
  });
}

export async function updateLedgerMapping(mappingId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(mappingId)) return gone("mapping");
    const ledgerName = str(fd, "ledgerName", 80);
    const costCentre = str(fd, "costCentre", 60);
    const updated = await updateRow("ledger_mappings", mappingId, { ledgerName: ledgerName || null, costCentre: costCentre || null, updatedAt: new Date().toISOString() });
    if (!updated) return gone("mapping");
    refresh();
    return succeeded(ledgerName ? `${updated.label} → ${ledgerName}` : `${updated.label} unmapped`, ledgerName ? "Replay failed vouchers to post them." : "Vouchers needing it will fail.");
  });
}

/** Which finance system the vouchers go to, and the company in it. */
export async function configureAccounting(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const system = oneOf(fd, "system", ACCOUNTING_SYSTEMS);
    if (!system) return failed("Choose the finance system");
    const company = str(fd, "company", 120);
    if (company.length < 2) return failed("Enter the company name as it appears in the finance system");
    const { data } = await readMany(["connectors"] as const);
    const connector = data.connectors.find((c) => c.key === "accounting");
    if (!connector) return gone("accounting connector");
    await updateRow("connectors", connector.id, {
      name: system,
      provider: system,
      config: { ...connector.config, company, voucherSeries: str(fd, "voucherSeries", 20) || connector.config.voucherSeries || "LUXUS" },
      updatedAt: new Date().toISOString(),
    });
    refresh();
    return succeeded(`Posting to ${system}`, company);
  });
}
