"use server";

import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { rupees } from "@/lib/gst";
import { OPERATOR } from "@/lib/operator";
import { allocateFifo, balance, daysPastDue, invoiceState } from "@/lib/receivables";
import { numberSeries } from "../numbering";
import { readMany, updateRow } from "../store";
import type { Dealer, Invoice, InvoicePayment } from "../types";
import { queueVoucher } from "../workflows/ledger";
import { dealerContact, ensureTemplate, sendMessage } from "../workflows/messaging";
import { applyReceipt } from "../workflows/receivables";
import { gone, int, isId, oneOf, refresh, str, type Prev } from "./input";
import { saving } from "./outcome";

/**
 * Billing & Invoices — receivables, as EV-CRM's finance module runs them:
 * receipts against one invoice or on account (spread oldest-first), credit
 * notes, payment reminders, and each dealer's credit limit and terms. Every
 * movement of money reaches the dealer's outstanding and the books.
 */

const MODES = ["NEFT/RTGS", "UPI", "Cheque"] as const satisfies readonly InvoicePayment["mode"][];
/** The dealer is the invoice's seller's customer — Luxus Green bills from Chhattisgarh. */
const OEM_STATE = "Chhattisgarh";

const REMINDER_TEMPLATE = "payment_reminder";
const REMINDER_BODY = "Dear {{1}}, invoice {{2}} for {{3}} was due on {{4}}. Please pay to avoid a hold on new orders — reply to this message for the bank details. Luxus Green Mobility";

function readReceipt(fd: FormData, max: number): { amount: number; mode: InvoicePayment["mode"]; reference: string } | ActionResult {
  const amount = int(fd, "amount", 1, max);
  if (amount === null) return failed(`Enter an amount up to ${rupees(max)}`);
  const mode = oneOf(fd, "mode", MODES) ?? "NEFT/RTGS";
  const reference = str(fd, "reference", 40).toUpperCase();
  if (reference.length < 4) return failed("Enter the UTR or cheque number");
  return { amount, mode, reference };
}

const isResult = (v: unknown): v is ActionResult => typeof v === "object" && v !== null && "ok" in v && "at" in v;

const usedReference = (invoices: Invoice[], reference: string) => invoices.some((i) => (i.payments ?? []).some((p) => p.reference.toUpperCase() === reference));

export async function recordInvoicePayment(invoiceId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(invoiceId)) return gone("invoice");
    const { data } = await readMany(["invoices", "dealers"] as const);
    const invoice = data.invoices.find((i) => i.id === invoiceId);
    if (!invoice) return gone("invoice");
    const due = balance(invoice);
    if (due <= 0) return failed("Already paid in full");
    const receipt = readReceipt(fd, due);
    if (isResult(receipt)) return receipt;
    if (usedReference(data.invoices, receipt.reference)) return failed(`${receipt.reference} is already recorded`, "The same UTR twice is almost always a duplicate entry.");

    const next = await applyReceipt(invoice, data.dealers.find((d) => d.name === invoice.dealer), receipt);
    refresh();
    return succeeded(`${rupees(receipt.amount)} received against ${invoice.invoiceNo}`, balance(next) <= 0 ? "Paid in full." : `${rupees(balance(next))} still due.`);
  });
}

/** A lump receipt from a dealer, not tied to one invoice — spread across its open invoices, oldest first. */
export async function recordDealerReceipt(dealerId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(dealerId)) return gone("dealer");
    const { data } = await readMany(["invoices", "dealers"] as const);
    const dealer = data.dealers.find((d) => d.id === dealerId);
    if (!dealer) return gone("dealer");
    const open = data.invoices.filter((i) => i.dealer === dealer.name && balance(i) > 0);
    const total = open.reduce((s, i) => s + balance(i), 0);
    if (!total) return failed(`${dealer.name} owes nothing on its invoices`);
    const receipt = readReceipt(fd, total);
    if (isResult(receipt)) return receipt;
    if (usedReference(data.invoices, receipt.reference)) return failed(`${receipt.reference} is already recorded`);

    const plan = allocateFifo(open, receipt.amount);
    let current: Dealer = dealer;
    for (const { invoice, amount } of plan) {
      await applyReceipt(invoice, current, { ...receipt, amount });
      current = { ...current, outstanding: Math.max(0, current.outstanding - amount) };
    }
    refresh();
    return succeeded(
      `${rupees(receipt.amount)} received from ${dealer.name}`,
      `Applied oldest first: ${plan.map((p) => `${p.invoice.invoiceNo} ${rupees(p.amount)}`).join(", ")}.`
    );
  });
}

/** Reduces what an invoice asks for — a price correction, damage in transit — and reverses it in the books. */
export async function raiseCreditNote(invoiceId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(invoiceId)) return gone("invoice");
    const { data } = await readMany(["invoices", "dealers"] as const);
    const invoice = data.invoices.find((i) => i.id === invoiceId);
    if (!invoice) return gone("invoice");
    const open = balance(invoice);
    if (open <= 0) return failed("Nothing is left to credit", "The invoice is settled.");
    const amount = int(fd, "amount", 1, open);
    if (amount === null) return failed(`A credit note is ₹1 up to the ${rupees(open)} still open`);
    const reason = str(fd, "reason", 300);
    if (reason.length < 5) return failed("Say why the dealer is being credited", "It prints on the credit note.");

    const no = numberSeries(
      data.invoices.flatMap((i) => (i.creditNotes ?? []).map((c) => c.no)),
      "DCN",
      500
    )();
    const note = { no, amount, reason, at: new Date().toISOString(), by: OPERATOR.name };
    const next: Invoice = { ...invoice, creditNotes: [...(invoice.creditNotes ?? []), note] };
    await updateRow("invoices", invoice.id, { creditNotes: next.creditNotes, status: balance(next) <= 0 ? "Paid" : invoice.status });
    const dealer = data.dealers.find((d) => d.name === invoice.dealer);
    if (dealer) await updateRow("dealers", dealer.id, { outstanding: Math.max(0, dealer.outstanding - amount) });
    const interState = (dealer?.state ?? OEM_STATE) !== OEM_STATE;
    const sales = invoice.type === "Vehicle" ? "sales_vehicle" : invoice.type === "Spare Part" ? "sales_parts" : "sales_service";
    const voucher = await queueVoucher({
      voucherType: "Credit Note",
      source: "Dealer Credit Note",
      sourceId: invoice.id,
      reference: `${no} · ${invoice.invoiceNo}`,
      party: invoice.dealer,
      amount,
      ledgers: ["debtors_dealers", sales, ...(interState ? (["output_igst"] as const) : (["output_cgst", "output_sgst"] as const))],
    });
    refresh();
    return succeeded(`Credit note ${no} for ${rupees(amount)}`, `${invoice.invoiceNo} now has ${rupees(balance(next))} open. Voucher ${voucher.status.toLowerCase()}.`);
  });
}

async function remind(invoice: Invoice): Promise<{ ok: boolean; error: string | null }> {
  await ensureTemplate(REMINDER_TEMPLATE, REMINDER_BODY);
  const contact = await dealerContact(invoice.dealer);
  const at = new Date().toISOString();
  if (!contact) {
    const error = "No active dealer login with a phone number — add one in User Management";
    await updateRow("invoices", invoice.id, { reminders: [...(invoice.reminders ?? []), { at, by: OPERATOR.name, to: "—", status: "Failed", error }] });
    return { ok: false, error };
  }
  const message = await sendMessage({
    channel: "WhatsApp",
    template: REMINDER_TEMPLATE,
    to: contact.phone,
    customer: invoice.dealer,
    vars: [contact.name, invoice.invoiceNo, rupees(balance(invoice)), new Date(invoice.dueOn).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })],
    related: { kind: "invoice", id: invoice.id, label: invoice.invoiceNo },
  });
  const status = message.status === "Failed" ? "Failed" : "Sent";
  await updateRow("invoices", invoice.id, { reminders: [...(invoice.reminders ?? []), { at, by: OPERATOR.name, to: `${contact.name} · ${contact.phone}`, status, error: message.error }] });
  return { ok: status === "Sent", error: message.error };
}

export async function sendPaymentReminder(invoiceId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(invoiceId)) return gone("invoice");
    const { data } = await readMany(["invoices"] as const);
    const invoice = data.invoices.find((i) => i.id === invoiceId);
    if (!invoice) return gone("invoice");
    if (balance(invoice) <= 0) return failed("Nothing is owed on this invoice");
    const result = await remind(invoice);
    refresh();
    return result.ok
      ? succeeded(`Reminder sent for ${invoice.invoiceNo}`, `${rupees(balance(invoice))} to ${invoice.dealer} on WhatsApp.`)
      : failed("The reminder did not go", result.error ?? undefined);
  });
}

/** Reminds every overdue invoice not already reminded in the last three days. */
export async function remindAllOverdue(): Promise<ActionResult> {
  return saving(async () => {
    const { data } = await readMany(["invoices"] as const);
    const recently = (i: Invoice) => (i.reminders ?? []).some((r) => r.status === "Sent" && Date.now() - new Date(r.at).getTime() < 3 * 86_400_000);
    const due = data.invoices.filter((i) => invoiceState(i) === "Overdue" && !recently(i)).sort((a, b) => daysPastDue(b) - daysPastDue(a));
    if (!due.length) return failed("Nothing to remind", "Every overdue invoice was reminded in the last three days, or none is overdue.");
    let sent = 0;
    let lastError: string | null = null;
    for (const invoice of due) {
      const r = await remind(invoice);
      if (r.ok) sent++;
      else lastError = r.error;
    }
    refresh();
    return sent === due.length
      ? succeeded(`${sent} reminder${sent === 1 ? "" : "s"} sent`, "On WhatsApp to each dealer's accounts contact.")
      : failed(`${sent} of ${due.length} reminders sent`, lastError ?? undefined);
  });
}

/** A dealer's credit limit and payment terms. Blank limit means none. */
export async function setCreditTerms(dealerId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(dealerId)) return gone("dealer");
    const limitRaw = str(fd, "creditLimit", 20);
    const creditLimit = limitRaw === "" ? null : int(fd, "creditLimit", 0, 1_000_000_000);
    if (limitRaw !== "" && creditLimit === null) return failed("The credit limit must be in whole rupees");
    const creditDays = int(fd, "creditDays", 0, 180);
    if (creditDays === null) return failed("Credit days are 0–180");
    const updated = await updateRow("dealers", dealerId, { creditLimit, creditDays });
    if (!updated) return gone("dealer");
    refresh();
    const over = creditLimit === null ? 0 : updated.outstanding - creditLimit;
    return succeeded(
      `${updated.name}: ${creditLimit === null ? "no credit limit" : `limit ${rupees(creditLimit)}`}, ${creditDays} days`,
      over > 0 ? `Already ${rupees(over)} over — new orders will wait for a credit approval.` : "Applies to orders placed from now."
    );
  });
}
