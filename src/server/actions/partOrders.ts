"use server";

import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { dealerCompliance } from "@/lib/compliance";
import { rupees } from "@/lib/gst";
import { OPERATOR } from "@/lib/operator";
import { dueDate } from "@/lib/receivables";
import { runtimeId } from "../ids";
import { nextNumber } from "../numbering";
import { insertRow, readMany, updateRow } from "../store";
import type { Invoice, PartOrder, SparePart, WorkflowEvent } from "../types";
import { queueVoucher, salesLedgers } from "../workflows/ledger";
import { dealerContact, ensureTemplate, sendMessage } from "../workflows/messaging";
import { logMovement } from "../workflows/stock";
import { dateField, gone, isId, refresh, str, type Prev } from "./input";
import { saving } from "./outcome";

/**
 * Dealer spare-part orders — EV-CRM's SparePartRequest, through the same
 * order desk as vehicle orders: a stock check against the OEM's parts stock
 * confirms the order and takes the parts off the shelf, or puts it on the
 * short list for a notice, a re-check, or a part shipment with a back-order.
 * Dispatch raises the GST invoice (18% on parts) against the dealer's
 * account; delivery closes it. Cancelling a confirmed order puts the parts
 * back. Every stock movement lands in the Inventory Logs.
 */

const PARTS_GST = 0.18;
/** Luxus Green bills dealers from Chhattisgarh. */
const OEM_STATE = "Chhattisgarh";
const MAX_LINES = 10;

const NOTICE_TEMPLATE = "stock_notice";
const NOTICE_BODY = "Dear {{1}}, order {{2}} cannot be met in full from stock: {{3}}. {{4}} Luxus Green Mobility";

const event = (status: string, note?: string): WorkflowEvent => ({ status, at: new Date().toISOString(), by: OPERATOR.name, ...(note ? { note } : {}) });

const valueOf = (lines: PartOrder["lines"]) => lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

function check(order: Pick<PartOrder, "lines">, parts: SparePart[]) {
  return order.lines.map((l) => ({ sku: l.sku, requested: l.quantity, available: parts.find((p) => p.id === l.partId)?.onHand ?? 0 }));
}
const describe = (lines: Array<{ sku: string; requested: number; available: number }>) => lines.map((c) => `${c.sku} ${Math.min(c.available, c.requested)}/${c.requested}`).join(", ");

async function load(orderId: string) {
  if (!isId(orderId)) return null;
  const { data } = await readMany(["part_orders", "spare_parts", "dealers", "compliance"] as const);
  const order = data.part_orders.find((o) => o.id === orderId);
  return order ? { order, data } : null;
}

export async function placePartOrder(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const { data } = await readMany(["part_orders", "spare_parts", "dealers", "compliance"] as const);
    const dealer = data.dealers.find((d) => d.name === str(fd, "dealer", 80));
    if (!dealer) return failed("Choose the dealer ordering");
    if (dealer.status === "Suspended") return failed(`${dealer.name} is suspended`);
    const lapsed = dealerCompliance(dealer.name, data.compliance).blocking;
    if (lapsed.length) return failed(`${dealer.name} is on compliance hold`, `${lapsed.map((r) => r.docType).join(", ")} expired — renew it under Compliance & Renewals.`);

    const ids = fd.getAll("partId").map(String);
    const qtys = fd.getAll("quantity").map(Number);
    const lines: PartOrder["lines"] = [];
    for (let i = 0; i < Math.min(ids.length, MAX_LINES); i++) {
      if (!ids[i]) continue;
      const part = data.spare_parts.find((p) => p.id === ids[i]);
      if (!part) return failed(`Line ${i + 1}: that part is no longer in the catalogue`);
      const q = qtys[i];
      if (!Number.isInteger(q) || q < 1 || q > 10_000) return failed(`Line ${i + 1}: quantity must be 1–10,000`);
      if (lines.some((l) => l.partId === part.id)) return failed(`${part.sku} is on the order twice`, "Put the whole quantity on one line.");
      lines.push({ partId: part.id, sku: part.sku, name: part.name, quantity: q, unitPrice: part.unitPrice });
    }
    if (!lines.length) return failed("Add at least one part");

    const value = valueOf(lines);
    // Credit control, as for vehicle orders: the order with GST on top of what the dealer owes.
    const exposure = dealer.outstanding + Math.round(value * (1 + PARTS_GST));
    if (dealer.creditLimit != null && exposure > dealer.creditLimit) {
      return failed(`${dealer.name} would be ${rupees(exposure - dealer.creditLimit)} over its credit limit`, "Record a receipt on its statement, or raise the limit, then order again.");
    }

    const order: PartOrder = {
      id: runtimeId("SPO"),
      orderNo: nextNumber(
        data.part_orders.map((o) => o.orderNo),
        "SPO",
        600
      ),
      dealer: dealer.name,
      lines,
      value,
      status: "Requested",
      placedAt: new Date().toISOString(),
      stockCheck: null,
      notice: null,
      backOrderOf: null,
      backOrderId: null,
      invoiceId: null,
      cancelReason: null,
      history: [event("Requested", `${lines.length} line${lines.length === 1 ? "" : "s"} for ${dealer.name}`)],
    };
    await insertRow("part_orders", order);
    refresh();
    return succeeded(`Parts order ${order.orderNo} placed`, `${rupees(value)} before GST — check stock next.`);
  });
}

/** The stock check: covered → the parts come off the shelf and the order is confirmed; not covered → short. */
async function checkAndTake(order: PartOrder, parts: SparePart[]): Promise<{ ok: boolean; lines: ReturnType<typeof check> }> {
  const lines = check(order, parts);
  const at = new Date().toISOString();
  const ok = lines.every((c) => c.available >= c.requested);
  if (ok) {
    for (const l of order.lines) {
      const part = parts.find((p) => p.id === l.partId);
      if (!part) continue;
      await updateRow("spare_parts", part.id, { onHand: part.onHand - l.quantity });
      part.onHand -= l.quantity;
      await logMovement({ entity: "Spare Part", reference: `${part.sku} · ${order.orderNo} · ${order.dealer}`, direction: "OUT", quantity: l.quantity, bucket: "Dealer Parts Order" });
    }
    await updateRow("part_orders", order.id, { status: "Confirmed", stockCheck: { at, lines }, history: [...order.history, event("Confirmed", `Picked from stock — ${describe(lines)}`)] });
  } else {
    await updateRow("part_orders", order.id, { status: "Short", stockCheck: { at, lines }, history: [...order.history, event("Short", describe(lines))] });
  }
  return { ok, lines };
}

export async function checkPartStock(orderId: string): Promise<ActionResult> {
  return saving(async () => {
    const loaded = await load(orderId);
    if (!loaded) return gone("order");
    const { order, data } = loaded;
    if (order.status !== "Requested" && order.status !== "Short") return failed(`A ${order.status.toLowerCase()} order is not checked again`);
    const r = await checkAndTake(order, data.spare_parts);
    refresh();
    return r.ok ? succeeded(`${order.orderNo} confirmed`, `Parts picked: ${describe(r.lines)}.`) : failed(`${order.orderNo} is short`, `${describe(r.lines)} — send the dealer a notice, or ship what is there.`);
  });
}

export async function sendPartNotice(orderId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const loaded = await load(orderId);
    if (!loaded) return gone("order");
    const { order, data } = loaded;
    if (order.status !== "Short") return failed("Only a short order gets an out-of-stock notice");
    const restockRaw = str(fd, "expectedRestock", 40);
    const expectedRestock = restockRaw ? dateField(fd, "expectedRestock") : null;
    if (restockRaw && (!expectedRestock || new Date(expectedRestock).getTime() < Date.now() - 86_400_000)) return failed("The restock date must be today or later");
    const message = str(fd, "message", 300) || null;
    const lines = check(order, data.spare_parts);

    const contact = await dealerContact(order.dealer);
    let sent = "No dealer login with a phone — the notice is on the order only.";
    if (contact) {
      await ensureTemplate(NOTICE_TEMPLATE, NOTICE_BODY);
      const m = await sendMessage({
        channel: "WhatsApp",
        template: NOTICE_TEMPLATE,
        to: contact.phone,
        customer: order.dealer,
        vars: [contact.name, order.orderNo, describe(lines), [expectedRestock ? `Expected restock ${new Date(expectedRestock).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}.` : "", message ?? ""].filter(Boolean).join(" ")],
        related: { kind: "part_order", id: order.id, label: order.orderNo },
      });
      sent = m.status === "Failed" ? `WhatsApp did not go: ${m.error}.` : `Sent to ${contact.name} on WhatsApp.`;
    }
    await updateRow("part_orders", order.id, { notice: { sentAt: new Date().toISOString(), expectedRestock, message }, history: [...order.history, event("Out-of-stock notice sent", message ?? undefined)] });
    refresh();
    return succeeded(`Notice sent for ${order.orderNo}`, sent);
  });
}

/** Ship what is on the shelf now; the rest becomes a back-order on the short list. */
export async function shipAvailableParts(orderId: string): Promise<ActionResult> {
  return saving(async () => {
    const loaded = await load(orderId);
    if (!loaded) return gone("order");
    const { order } = loaded;
    const { data } = await readMany(["part_orders", "spare_parts"] as const);
    if (order.status !== "Short") return failed("Only a short order is split");
    const now: PartOrder["lines"] = [];
    const later: PartOrder["lines"] = [];
    for (const l of order.lines) {
      const have = Math.min(l.quantity, data.spare_parts.find((p) => p.id === l.partId)?.onHand ?? 0);
      if (have) now.push({ ...l, quantity: have });
      if (l.quantity - have) later.push({ ...l, quantity: l.quantity - have });
    }
    if (!now.length) return failed("Nothing on the shelf to ship yet");
    let backOrderNo = "";
    let backOrderId: string | null = null;
    if (later.length) {
      const back: PartOrder = {
        ...order,
        id: runtimeId("SPO"),
        orderNo: nextNumber(
          data.part_orders.map((o) => o.orderNo),
          "SPO",
          600
        ),
        lines: later,
        value: valueOf(later),
        status: "Short",
        placedAt: new Date().toISOString(),
        notice: null,
        backOrderOf: order.id,
        backOrderId: null,
        invoiceId: null,
        history: [event("Short", `Back-order of ${order.orderNo}`)],
      };
      await insertRow("part_orders", back);
      backOrderNo = back.orderNo;
      backOrderId = back.id;
    }
    const cut: PartOrder = { ...order, lines: now, value: valueOf(now), backOrderId, history: [...order.history, event("Split", backOrderNo ? `Rest back-ordered as ${backOrderNo}` : "Everything is in stock now")] };
    await updateRow("part_orders", order.id, { lines: cut.lines, value: cut.value, backOrderId, history: cut.history });
    const r = await checkAndTake(cut, data.spare_parts);
    refresh();
    return r.ok ? succeeded(`${order.orderNo} confirmed for what is in stock`, backOrderNo ? `The rest is back-ordered as ${backOrderNo}.` : "Nothing left to back-order.") : failed("Stock moved while splitting", "Check the order again.");
  });
}

/** Dispatch raises the GST invoice on the dealer's account. */
export async function dispatchPartOrder(orderId: string): Promise<ActionResult> {
  return saving(async () => {
    const loaded = await load(orderId);
    if (!loaded) return gone("order");
    const { order, data } = loaded;
    if (order.status !== "Confirmed") return failed("Only a confirmed order is dispatched");
    const { data: more } = await readMany(["invoices"] as const);
    const dealer = data.dealers.find((d) => d.name === order.dealer);
    const invoice: Invoice = {
      id: runtimeId("INV"),
      invoiceNo: nextNumber(
        more.invoices.map((i) => i.invoiceNo),
        "INV",
        7700
      ),
      dealer: order.dealer,
      type: "Spare Part",
      amount: Math.round(order.value * (1 + PARTS_GST)),
      received: 0,
      status: "Unpaid",
      issuedAt: new Date().toISOString(),
      dueOn: dueDate(dealer),
    };
    await insertRow("invoices", invoice);
    if (dealer) await updateRow("dealers", dealer.id, { outstanding: dealer.outstanding + invoice.amount });
    await queueVoucher({
      voucherType: "Sales",
      source: "Dealer Invoice",
      sourceId: invoice.id,
      reference: invoice.invoiceNo,
      party: order.dealer,
      amount: invoice.amount,
      ledgers: salesLedgers("parts", (dealer?.state ?? OEM_STATE) !== OEM_STATE, "dealer"),
    });
    await updateRow("part_orders", order.id, { status: "Dispatched", invoiceId: invoice.id, history: [...order.history, event("Dispatched", `Invoice ${invoice.invoiceNo} for ${rupees(invoice.amount)} incl. 18% GST`)] });
    refresh();
    return succeeded(`${order.orderNo} dispatched`, `Invoice ${invoice.invoiceNo} for ${rupees(invoice.amount)} — on ${order.dealer}'s account.`);
  });
}

export async function deliverPartOrder(orderId: string): Promise<ActionResult> {
  return saving(async () => {
    const loaded = await load(orderId);
    if (!loaded) return gone("order");
    const { order } = loaded;
    if (order.status !== "Dispatched") return failed("Only a dispatched order is delivered");
    await updateRow("part_orders", order.id, { status: "Delivered", history: [...order.history, event("Delivered")] });
    refresh();
    return succeeded(`${order.orderNo} delivered`, order.dealer);
  });
}

export async function cancelPartOrder(orderId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const loaded = await load(orderId);
    if (!loaded) return gone("order");
    const { order, data } = loaded;
    const reason = str(fd, "reason", 300);
    if (reason.length < 3) return failed("Say why the order is being cancelled");
    if (!["Requested", "Short", "Confirmed"].includes(order.status)) return failed(`A ${order.status.toLowerCase()} order can't be cancelled`);
    // Picked parts go back on the shelf.
    if (order.status === "Confirmed") {
      for (const l of order.lines) {
        const part = data.spare_parts.find((p) => p.id === l.partId);
        if (!part) continue;
        await updateRow("spare_parts", part.id, { onHand: part.onHand + l.quantity });
        await logMovement({ entity: "Spare Part", reference: `${part.sku} · ${order.orderNo} cancelled`, direction: "IN", quantity: l.quantity, bucket: "Order Cancelled" });
      }
    }
    await updateRow("part_orders", order.id, { status: "Cancelled", cancelReason: reason, history: [...order.history, event("Cancelled", reason)] });
    refresh();
    return succeeded(`${order.orderNo} cancelled`, order.status === "Confirmed" ? `${reason} · parts back in stock.` : reason);
  });
}
