"use server";

import { revalidatePath } from "next/cache";
import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { OPERATOR } from "@/lib/operator";
import { GST_RATE } from "@/lib/orders";
import { dueDate } from "@/lib/receivables";
import { dealerCompliance } from "@/lib/compliance";
import { checkLines, coversAll, freeOemStock, lineKey, reservedTo, shortfall, type LineCheck } from "@/lib/stock";
import { rupees } from "@/lib/gst";
import { VEHICLE_MODELS } from "@/lib/vehicles";
import { runtimeId } from "../ids";
import { numericRef } from "../numbering";
import { insertRow, readCollection, readMany, updateRow } from "../store";
import { ORDER_FLOW, ORDER_VARIANTS, type Approval, type Invoice, type InventoryLog, type Order, type OrderEvent, type OrderLine, type VehicleUnit } from "../types";
import { queueVoucher, salesLedgers } from "../workflows/ledger";
import { logMovement } from "../workflows/stock";
import { saving } from "./outcome";
import { dealerContact, ensureTemplate, sendMessage } from "../workflows/messaging";

/** Luxus Green invoices dealers from its Bilaspur plant — a dealer elsewhere is an inter-state supply. */
const OEM_STATE = "Chhattisgarh";

/**
 * Order management — every write to a dealer order.
 *
 * An order moves Placed → Acknowledged → In Production → Dispatched →
 * Received, and can be cancelled (with a reason) up to dispatch. Dispatching
 * is the OEM → dealer handoff and does what it would in the real system: it
 * raises the GST invoice under Billing & Invoices and books the units out in
 * the Inventory Logs, so the order, the bill and the stock movement agree.
 *
 * Like every action here, each is a public POST endpoint — nothing it receives
 * is trusted, bound ids included — and each reports what actually happened.
 */

type Prev = ActionResult | null;

const MAX_LINES = 12;
const CANCELLABLE: ReadonlyArray<Order["status"]> = ["Placed", "Stock Short", "Acknowledged", "In Production"];

const NEXT_LABEL: Record<(typeof ORDER_FLOW)[number], string> = {
  Placed: "acknowledged",
  Acknowledged: "in production",
  "In Production": "dispatched",
  Dispatched: "received",
  Received: "received",
};

const isId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9-]{1,64}$/.test(value);
const str = (fd: FormData, key: string, max = 200) => String(fd.get(key) ?? "").trim().slice(0, max);

function touch(orderId?: string) {
  for (const path of ["/dms/orders", "/dms/orders/invoices", "/dms/inventory/logs", "/dms/inventory/vehicles", "/erp/accounting", "/erp/analytics", "/"]) revalidatePath(path);
  if (orderId) revalidatePath(`/dms/orders/${orderId}`);
}

/** Next number in a `PREFIX/26/NNNN` series, one past the highest in use. */
function nextNumber(existing: string[], prefix: string, floor: number): string {
  const highest = existing.reduce((max, value) => {
    const n = Number(value.split("/").pop());
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, floor);
  return `${prefix}/26/${highest + 1}`;
}

/** The lines as submitted — parallel `model` / `variant` / `quantity` / `unitPrice` fields. */
function readLines(fd: FormData): OrderLine[] | string {
  const models = fd.getAll("model").map(String);
  const variants = fd.getAll("variant").map(String);
  const quantities = fd.getAll("quantity").map(Number);
  const prices = fd.getAll("unitPrice").map(Number);

  if (models.length === 0) return "Add at least one line";
  if (models.length > MAX_LINES) return `An order can have at most ${MAX_LINES} lines`;
  if (variants.length !== models.length || quantities.length !== models.length || prices.length !== models.length) return "The order lines are incomplete";

  const lines: OrderLine[] = [];
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const variant = variants[i] as OrderLine["variant"];
    const quantity = quantities[i];
    const unitPrice = prices[i];
    if (!VEHICLE_MODELS.includes(model)) return `Line ${i + 1}: choose a model from the list`;
    if (!ORDER_VARIANTS.includes(variant)) return `Line ${i + 1}: choose a variant from the list`;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) return `Line ${i + 1}: quantity must be a whole number from 1 to 500`;
    if (!Number.isFinite(unitPrice) || unitPrice < 10_000 || unitPrice > 10_000_000) return `Line ${i + 1}: unit price must be between ₹10,000 and ₹1 Cr`;
    lines.push({ model, variant, quantity, unitPrice: Math.round(unitPrice) });
  }
  return lines;
}

const event = (status: string, note?: string): OrderEvent => ({
  status,
  at: new Date().toISOString(),
  by: OPERATOR.name,
  ...(note ? { note } : {}),
});

// ---------------------------------------------------------------------------

export async function placeOrder(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const dealerName = str(fd, "dealer");
    const [{ rows: dealers }, { rows: orders }] = await Promise.all([readCollection("dealers"), readCollection("orders")]);
    const dealer = dealers.find((d) => d.name === dealerName);
    if (!dealer) return failed("Choose the dealer placing the order");
    if (dealer.status === "Suspended") return failed(`${dealer.name} is suspended`, "A suspended dealer cannot place orders.");
    // Compliance hold: no new orders while the dealer agreement or trade licence has lapsed.
    const { rows: compliance } = await readCollection("compliance");
    const lapsed = dealerCompliance(dealer.name, compliance).blocking;
    if (lapsed.length) return failed(`${dealer.name} is on compliance hold`, `${lapsed.map((r) => `${r.docType} expired ${new Date(r.expiresOn).toLocaleDateString("en-IN")}`).join("; ")} — renew it under Compliance & Renewals.`);

    const lines = readLines(fd);
    if (typeof lines === "string") return failed(lines);

    const expectedInput = str(fd, "expectedBy");
    const expected = expectedInput ? new Date(expectedInput) : new Date(Date.now() + 21 * 86_400_000);
    if (Number.isNaN(expected.getTime()) || expected.getTime() < Date.now() - 86_400_000) return failed("The expected date must be today or later");

    const units = lines.reduce((sum, line) => sum + line.quantity, 0);
    const order: Order = {
      id: runtimeId("ORD"),
      orderNo: nextNumber(orders.map((o) => o.orderNo), "PO", 2300),
      dealer: dealer.name,
      lineItems: lines.length,
      units,
      value: lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
      status: "Placed",
      placedAt: new Date().toISOString(),
      expectedBy: expected.toISOString(),
      lines,
      history: [event("Placed", `Recorded on behalf of ${dealer.name}`)],
      placedBy: OPERATOR.name,
      invoiceId: null,
    };

    // Credit control: the order's value with GST on top of what the dealer already owes, against its limit.
    const exposure = dealer.outstanding + Math.round(order.value * (1 + GST_RATE));
    if (dealer.creditLimit != null && exposure > dealer.creditLimit) {
      const approval: Approval = {
        id: runtimeId("APR"),
        type: "Credit Limit",
        subject: `${order.orderNo} · ${dealer.name}`,
        requestedBy: OPERATOR.name,
        pendingWith: "Finance Controller",
        raisedAt: new Date().toISOString(),
        ageingHours: 0,
        status: "Pending",
        link: { kind: "order", id: order.id },
        detail: `Takes ${dealer.name} to ${rupees(exposure)} owed against a ${rupees(dealer.creditLimit)} limit — ${rupees(exposure - dealer.creditLimit)} over`,
      };
      await insertRow("approvals", approval);
      order.creditHold = { approvalId: approval.id, exposure, limit: dealer.creditLimit };
      order.history = [...(order.history ?? []), event("Placed", `Credit hold — ${approval.detail}`)];
      await insertRow("orders", order);
      touch(order.id);
      return succeeded(`Order ${order.orderNo} placed on credit hold`, `${rupees(exposure - dealer.creditLimit)} over ${dealer.name}'s limit — it waits for the Finance Controller in the approvals queue.`);
    }

    await insertRow("orders", order);
    touch(order.id);
    return succeeded(`Order ${order.orderNo} placed`, `${units} unit${units === 1 ? "" : "s"} for ${dealer.name} — awaiting acknowledgement.`);
  });
}

/** Moves an order one step along the flow. Dispatch also raises the invoice and books the stock out. */
export async function advanceOrder(orderId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(orderId)) return failed("That order no longer exists");
    const { rows: orders } = await readCollection("orders");
    const order = orders.find((o) => o.id === orderId);
    if (!order) return failed("That order no longer exists");
    if (order.status === "Cancelled") return failed("This order was cancelled");
    if (order.status === "Received") return failed("Already received", "The dealer has this order.");
    if (order.creditHold) return failed("This order is on credit hold", "The dealer is over its credit limit — the Finance Controller decides it in the approvals queue.");
    if (order.status === "Stock Short") return failed("This order is short of stock", "Re-check it once stock arrives, or ship what is in stock and back-order the rest.");

    // Acknowledging is the stock check (EV-CRM's Check Inventory): confirmed and reserved when OEM stock covers it, short otherwise.
    if (order.status === "Placed" && order.lines?.length) {
      const result = await checkAndReserve(order);
      touch(orderId);
      return result.ok
        ? succeeded(`Order ${order.orderNo} confirmed`, `Stock reserved from OEM stock: ${describe(result.checks)}.`)
        : failed(`Order ${order.orderNo} is short of stock`, `${describe(result.checks)} — it is on the short list for a notice and a re-check.`);
    }

    const next = ORDER_FLOW[ORDER_FLOW.indexOf(order.status as (typeof ORDER_FLOW)[number]) + 1];
    const history = [...(order.history ?? []), event(next)];

    if (next === "Dispatched") {
      const [{ rows: invoices }, { rows: dealersNow }] = await Promise.all([readCollection("invoices"), readCollection("dealers")]);
      const billTo = dealersNow.find((d) => d.name === order.dealer);
      const amount = Math.round(order.value * (1 + GST_RATE));
      const invoice: Invoice = {
        id: runtimeId("INV"),
        invoiceNo: nextNumber(invoices.map((i) => i.invoiceNo), "INV", 7700),
        dealer: order.dealer,
        type: "Vehicle",
        amount,
        received: 0,
        status: "Unpaid",
        issuedAt: new Date().toISOString(),
        // Due on the dealer's own credit terms.
        dueOn: dueDate(billTo),
        orderId: order.id,
      };
      const log: InventoryLog = {
        id: runtimeId("ILOG"),
        at: new Date().toISOString(),
        entity: "Vehicle",
        reference: order.orderNo,
        direction: "OUT",
        quantity: order.units,
        bucket: "Dealer Dispatch",
        actor: OPERATOR.name,
      };
      await insertRow("invoices", invoice);
      await insertRow("inventory_logs", log);

      // The vehicles themselves: on their way to the dealer, in stock once received.
      const { data } = await readMany(["vehicle_units", "products", "dealers"] as const);
      const reserved = reservedTo(data.vehicle_units, order.id);
      for (const u of reserved) await updateRow("vehicle_units", u.id, { status: "In Transit", location: order.dealer });
      const taken = new Set(data.vehicle_units.map((u) => u.vin));
      let created = reserved.length;
      // An order confirmed before stock checks has nothing reserved: its vehicles are built to order, as before.
      for (const line of reserved.length ? [] : (order.lines ?? [])) {
        const exShowroom = data.products.find((p) => p.model === line.model)?.variants.find((v) => v.variant === line.variant)?.exShowroom;
        for (let i = 0; i < line.quantity; i++) {
          let vin = "";
          do vin = `MA3LX${numericRef(2)}EV${numericRef(6)}`;
          while (taken.has(vin));
          taken.add(vin);
          const unit: VehicleUnit = {
            id: runtimeId("VIN"),
            vin,
            model: line.model,
            variant: line.variant,
            location: order.dealer,
            status: "In Transit",
            ageingDays: 0,
            price: exShowroom ?? Math.round(line.unitPrice * (1 + GST_RATE) * 1.1),
            bookingId: null,
            orderId: order.id,
          };
          await insertRow("vehicle_units", unit);
          created++;
        }
      }

      const dealerRow = data.dealers.find((d) => d.name === order.dealer);
      const dealerState = dealerRow?.state;
      // What the dealer now owes: the invoice joins its outstanding.
      if (dealerRow) await updateRow("dealers", dealerRow.id, { outstanding: dealerRow.outstanding + invoice.amount });
      await queueVoucher({
        voucherType: "Sales",
        source: "Dealer Invoice",
        sourceId: invoice.id,
        reference: invoice.invoiceNo,
        party: order.dealer,
        amount: invoice.amount,
        ledgers: salesLedgers("vehicle", dealerState !== OEM_STATE, "dealer"),
      });
      await updateRow("orders", orderId, { status: next, history, invoiceId: invoice.id });
      touch(orderId);
      return succeeded(
        `Order ${order.orderNo} dispatched`,
        `Invoice ${invoice.invoiceNo} raised for the order value plus 5% GST; ${created || order.units} vehicles in transit to ${order.dealer}.`
      );
    }

    if (next === "Received") {
      const { rows: units } = await readCollection("vehicle_units");
      const arriving = units.filter((u) => u.orderId === order.id && u.status === "In Transit");
      for (const u of arriving) await updateRow("vehicle_units", u.id, { status: "In Stock" });
      if (arriving.length) await logMovement({ entity: "Vehicle", reference: order.orderNo, direction: "IN", quantity: arriving.length, bucket: "Dealer Receipt" });
    }

    await updateRow("orders", orderId, { status: next, history });
    touch(orderId);
    return succeeded(`Order ${order.orderNo} ${NEXT_LABEL[order.status as (typeof ORDER_FLOW)[number]]}`, order.dealer);
  });
}

export async function cancelOrder(orderId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const reason = str(fd, "reason", 300);
    if (!isId(orderId)) return failed("That order no longer exists");
    if (reason.length < 3) return failed("Say why the order is being cancelled");

    const { rows: orders } = await readCollection("orders");
    const order = orders.find((o) => o.id === orderId);
    if (!order) return failed("That order no longer exists");
    if (!CANCELLABLE.includes(order.status)) {
      return failed(`A ${order.status.toLowerCase()} order can't be cancelled`, "Only orders that have not been dispatched can be.");
    }

    // Anything reserved for it goes back into OEM stock.
    const { rows: units } = await readCollection("vehicle_units");
    const released = reservedTo(units, order.id);
    for (const u of released) await updateRow("vehicle_units", u.id, { status: "In Stock", orderId: null });

    await updateRow("orders", orderId, {
      status: "Cancelled",
      cancelReason: reason,
      history: [...(order.history ?? []), event("Cancelled", reason)],
    });
    touch(orderId);
    return succeeded(`Order ${order.orderNo} cancelled`, released.length ? `${reason} · ${released.length} reserved vehicles back in OEM stock.` : reason);
  });
}

// ---------------------------------------------------------------------------
// Stock check, short orders and back-orders — EV-CRM's Check Inventory and
// Close Orders.
// ---------------------------------------------------------------------------

const describe = (checks: LineCheck[]) => checks.map((c) => `${c.model} ${c.variant} ${Math.min(c.available, c.requested)}/${c.requested}`).join(", ");

/** Checks the order's lines against free OEM stock; reserves the vehicles and acknowledges it when covered, marks it short when not. */
async function checkAndReserve(order: Order): Promise<{ ok: boolean; checks: LineCheck[] }> {
  const { data } = await readMany(["vehicle_units", "dealers"] as const);
  const stock = freeOemStock(data.vehicle_units, data.dealers);
  const checks = checkLines(order, stock);
  const at = new Date().toISOString();
  const ok = coversAll(checks);
  const stockCheck = { at, by: OPERATOR.name, sufficient: ok, lines: checks };
  if (ok) {
    for (const line of order.lines ?? []) {
      for (const u of (stock.get(lineKey(line)) ?? []).slice(0, line.quantity)) await updateRow("vehicle_units", u.id, { status: "Allocated", orderId: order.id });
    }
    await updateRow("orders", order.id, {
      status: "Acknowledged",
      stockCheck,
      history: [...(order.history ?? []), event("Stock checked", `Covered — ${describe(checks)}`), event("Acknowledged", `${order.units} vehicles reserved from OEM stock`)],
    });
  } else {
    await updateRow("orders", order.id, {
      status: "Stock Short",
      stockCheck,
      history: [...(order.history ?? []), event("Stock checked", `${shortfall(checks)} short — ${describe(checks)}`), event("Stock Short")],
    });
  }
  return { ok, checks };
}

/** Re-runs the check on a short order — the CRM's "order renewal" once stock has come in. */
export async function recheckStock(orderId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(orderId)) return failed("That order no longer exists");
    const { rows } = await readCollection("orders");
    const order = rows.find((o) => o.id === orderId);
    if (!order) return failed("That order no longer exists");
    if (order.status !== "Stock Short") return failed("Only a short order is re-checked");
    const result = await checkAndReserve(order);
    touch(orderId);
    return result.ok
      ? succeeded(`Order ${order.orderNo} confirmed`, `Stock has come in — reserved: ${describe(result.checks)}.`)
      : failed("Still short", `${describe(result.checks)}.`);
  });
}

const NOTICE_TEMPLATE = "stock_notice";
const NOTICE_BODY = "Dear {{1}}, order {{2}} cannot be met in full from stock: {{3}}. {{4}} Luxus Green Mobility";

/** The out-of-stock notice: what is short, when stock is expected, and whether part of it can ship now. */
export async function sendStockNotice(orderId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(orderId)) return failed("That order no longer exists");
    const { data } = await readMany(["orders", "vehicle_units", "dealers"] as const);
    const order = data.orders.find((o) => o.id === orderId);
    if (!order) return failed("That order no longer exists");
    if (order.status !== "Stock Short") return failed("Only a short order gets an out-of-stock notice");
    const restockRaw = str(fd, "expectedRestock", 40);
    const restock = restockRaw ? new Date(restockRaw) : null;
    if (restock && (Number.isNaN(restock.getTime()) || restock.getTime() < Date.now() - 86_400_000)) return failed("The restock date must be today or later");
    const message = str(fd, "message", 300) || null;
    // The partial offer is whatever live stock can cover right now.
    const checks = checkLines(order, freeOemStock(data.vehicle_units, data.dealers));
    const offeredUnits = fd.get("offer") === "on" ? checks.reduce((s, c) => s + Math.min(c.available, c.requested), 0) : null;
    if (offeredUnits === 0) return failed("Nothing is in stock to offer now", "Send the notice without a partial offer.");

    const contact = await dealerContact(order.dealer);
    let sent = "No dealer login with a phone — the notice is on the order only.";
    if (contact) {
      await ensureTemplate(NOTICE_TEMPLATE, NOTICE_BODY);
      const m = await sendMessage({
        channel: "WhatsApp",
        template: NOTICE_TEMPLATE,
        to: contact.phone,
        customer: order.dealer,
        vars: [
          contact.name,
          order.orderNo,
          describe(checks),
          [restock ? `Expected restock ${restock.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}.` : "", offeredUnits ? `${offeredUnits} can ship now if you accept part delivery.` : "", message ?? ""].filter(Boolean).join(" "),
        ],
        related: { kind: "order", id: order.id, label: order.orderNo },
      });
      sent = m.status === "Failed" ? `WhatsApp did not go: ${m.error}.` : `Sent to ${contact.name} on WhatsApp.`;
    }
    const at = new Date().toISOString();
    await updateRow("orders", order.id, {
      notice: { sentAt: at, by: OPERATOR.name, expectedRestock: restock?.toISOString() ?? null, message, offeredUnits },
      history: [...(order.history ?? []), event("Out-of-stock notice sent", [restock && `restock ${restock.toLocaleDateString("en-IN")}`, offeredUnits && `${offeredUnits} offered now`, message].filter(Boolean).join(" · ") || undefined)],
    });
    touch(orderId);
    return succeeded(`Notice sent for ${order.orderNo}`, sent);
  });
}

/**
 * The dealer takes what is in stock now: this order is cut to what stock
 * covers and confirmed, and the rest becomes a back-order on the short list.
 */
export async function shipAvailable(orderId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(orderId)) return failed("That order no longer exists");
    const { data } = await readMany(["orders", "vehicle_units", "dealers"] as const);
    const order = data.orders.find((o) => o.id === orderId);
    if (!order) return failed("That order no longer exists");
    if (order.status !== "Stock Short" || !order.lines?.length) return failed("Only a short order is split");
    const stock = freeOemStock(data.vehicle_units, data.dealers);
    const now: OrderLine[] = [];
    const later: OrderLine[] = [];
    for (const l of order.lines) {
      const have = Math.min(l.quantity, stock.get(lineKey(l))?.length ?? 0);
      if (have) now.push({ ...l, quantity: have });
      if (l.quantity - have) later.push({ ...l, quantity: l.quantity - have });
    }
    if (!now.length) return failed("Nothing is in stock to ship yet");
    if (!later.length) return recheckStockInline(order);

    const sum = (lines: OrderLine[]) => ({ lineItems: lines.length, units: lines.reduce((s, l) => s + l.quantity, 0), value: lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) });
    const backOrder: Order = {
      ...order,
      id: runtimeId("ORD"),
      orderNo: nextNumber(data.orders.map((o) => o.orderNo), "PO", 2300),
      ...sum(later),
      lines: later,
      status: "Stock Short",
      placedAt: new Date().toISOString(),
      history: [event("Placed", `Back-order of ${order.orderNo} — what stock could not cover`), event("Stock Short")],
      invoiceId: null,
      creditHold: null,
      notice: null,
      backOrderOf: order.id,
      backOrderId: null,
      stockCheck: order.stockCheck,
    };
    await insertRow("orders", backOrder);
    const cut: Order = { ...order, ...sum(now), lines: now, backOrderId: backOrder.id, history: [...(order.history ?? []), event("Split", `Shipping ${sum(now).units} now; ${backOrder.units} back-ordered as ${backOrder.orderNo}`)] };
    await updateRow("orders", order.id, { ...sum(now), lines: now, backOrderId: backOrder.id, history: cut.history });
    const result = await checkAndReserve(cut);
    touch(orderId);
    return result.ok
      ? succeeded(`${order.orderNo} cut to ${cut.units} and confirmed`, `${backOrder.units} back-ordered as ${backOrder.orderNo}.`)
      : failed("Stock moved while splitting", "Re-check the order.");
  });
}

async function recheckStockInline(order: Order): Promise<ActionResult> {
  const result = await checkAndReserve(order);
  touch(order.id);
  return result.ok ? succeeded(`Order ${order.orderNo} confirmed`, "Everything is in stock now — nothing to back-order.") : failed("Still short", describe(result.checks));
}
