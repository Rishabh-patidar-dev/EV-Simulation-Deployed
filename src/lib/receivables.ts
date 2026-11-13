import type { Dealer, Invoice } from "@/server/types";

/**
 * Dealer receivables — the arithmetic behind Billing & Invoices, following
 * EV-CRM's receivables.service.ts:
 *
 *  - An invoice's balance is what it was billed for less receipts and
 *    credit notes; its state (Unpaid / Part Paid / Overdue / Paid) is
 *    computed from that balance and the due date every time it is read, so it
 *    can never go stale the way a stored "Overdue" does.
 *  - Ageing uses the CRM's buckets, by days since issue.
 *  - A receipt not tied to one invoice is allocated oldest-first (FIFO), as a
 *    ledger books an on-account receipt.
 *
 * Credit terms (30 days, no limit) are the simulation's default policy where
 * a dealer has none of its own.
 */

const DAY = 86_400_000;

/** Days to pay when the dealer has no terms of its own. */
export const DEFAULT_CREDIT_DAYS = 30;

export const credited = (i: Invoice) => (i.creditNotes ?? []).reduce((s, c) => s + c.amount, 0);

/** What is still owed on one invoice. */
export const balance = (i: Invoice) => Math.max(0, i.amount - i.received - credited(i));

/** The invoice's state, read off its balance and due date — never the stored field. */
export function invoiceState(i: Invoice, now = Date.now()): Invoice["status"] {
  const open = balance(i);
  if (open <= 0) return "Paid";
  if (new Date(i.dueOn).getTime() < now) return "Overdue";
  return i.received + credited(i) > 0 ? "Part Paid" : "Unpaid";
}

export const daysPastDue = (i: Invoice, now = Date.now()) => Math.max(0, Math.floor((now - new Date(i.dueOn).getTime()) / DAY));
export const ageDays = (i: Invoice, now = Date.now()) => Math.max(0, Math.floor((now - new Date(i.issuedAt).getTime()) / DAY));

export interface Ageing {
  current: number;
  d30: number;
  d60: number;
  d90plus: number;
}

/** Open balances by age since issue: ≤30, 31–60, 61–90, 90+ days. */
export function ageing(invoices: Invoice[], now = Date.now()): Ageing {
  const out: Ageing = { current: 0, d30: 0, d60: 0, d90plus: 0 };
  for (const i of invoices) {
    const open = balance(i);
    if (!open) continue;
    const age = ageDays(i, now);
    if (age <= 30) out.current += open;
    else if (age <= 60) out.d30 += open;
    else if (age <= 90) out.d60 += open;
    else out.d90plus += open;
  }
  return out;
}

/** How a receipt not tied to one invoice is spread: oldest open invoice first. */
export function allocateFifo(invoices: Invoice[], amount: number): Array<{ invoice: Invoice; amount: number }> {
  const out: Array<{ invoice: Invoice; amount: number }> = [];
  let left = amount;
  for (const i of [...invoices].sort((a, b) => +new Date(a.issuedAt) - +new Date(b.issuedAt))) {
    if (left <= 0) break;
    const open = balance(i);
    if (!open) continue;
    const take = Math.min(open, left);
    out.push({ invoice: i, amount: take });
    left -= take;
  }
  return out;
}

/** A dealer's exposure against its credit limit. `limit` null means no limit is set. */
export function creditPosition(dealer: Pick<Dealer, "outstanding" | "creditLimit">) {
  const limit = dealer.creditLimit ?? null;
  const used = dealer.outstanding;
  return { limit, used, available: limit === null ? null : limit - used, utilisation: limit ? Math.round((used / limit) * 100) : null };
}

/** The due date for an invoice issued now, on the dealer's terms. */
export function dueDate(dealer: Pick<Dealer, "creditDays"> | undefined, from = Date.now()): string {
  return new Date(from + (dealer?.creditDays ?? DEFAULT_CREDIT_DAYS) * DAY).toISOString();
}

/** Tone for a balance: red once late, amber in its last week, otherwise plain. */
export function dueTone(i: Invoice, now = Date.now()): "negative" | "warning" | "neutral" {
  if (!balance(i)) return "neutral";
  const left = new Date(i.dueOn).getTime() - now;
  return left < 0 ? "negative" : left < 7 * DAY ? "warning" : "neutral";
}
