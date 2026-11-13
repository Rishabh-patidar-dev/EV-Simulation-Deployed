import "server-only";
import { OPERATOR } from "@/lib/operator";
import { balance } from "@/lib/receivables";
import { updateRow } from "../store";
import type { Dealer, Invoice, InvoicePayment } from "../types";
import { queueVoucher } from "./ledger";

/**
 * Money coming in against dealer invoices — one place for every way it
 * arrives (a receipt typed in, a gateway payment captured, an on-account
 * receipt spread oldest-first), so each one does the same three things: the
 * invoice's receipts, the dealer's outstanding, and a receipt voucher.
 */
export async function applyReceipt(invoice: Invoice, dealer: Dealer | undefined, input: { amount: number; mode: InvoicePayment["mode"]; reference: string }): Promise<Invoice> {
  const payment: InvoicePayment = { at: new Date().toISOString(), amount: input.amount, mode: input.mode, reference: input.reference, by: OPERATOR.name };
  const next: Invoice = { ...invoice, received: invoice.received + input.amount, payments: [...(invoice.payments ?? []), payment] };
  // The stored status is kept for older readers; screens compute it (lib/receivables).
  next.status = balance(next) <= 0 ? "Paid" : "Part Paid";
  await updateRow("invoices", invoice.id, { received: next.received, status: next.status, payments: next.payments });
  if (dealer) await updateRow("dealers", dealer.id, { outstanding: Math.max(0, dealer.outstanding - input.amount) });
  await queueVoucher({
    voucherType: "Receipt",
    source: "Dealer Payment",
    sourceId: invoice.id,
    reference: `${invoice.invoiceNo} · ${input.reference}`,
    party: invoice.dealer,
    amount: input.amount,
    ledgers: ["bank", "debtors_dealers"],
  });
  return next;
}
