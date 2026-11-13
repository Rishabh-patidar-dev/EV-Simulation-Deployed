"use server";

import { redirect } from "next/navigation";
import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { pmEDriveIncentive } from "@/lib/finance";
import { GST_RATE_STANDARD, GST_RATE_VEHICLE, HSN, INDIAN_STATES, isValidGstin, rupees, stateOfGstin } from "@/lib/gst";
import { idvFor, quoteInsurance } from "@/lib/insurance";
import { OPERATOR } from "@/lib/operator";
import { DEAL_STAGES_BEFORE_QUOTATION, DISCOUNT_LIMIT_PCT, EXTENDED_WARRANTY_PCT, QUOTE_VALID_DAYS, TOKEN_PCT, quoteStatus, quoteTotals, quoteUnits } from "@/lib/quotes";
import { RTO_FEES } from "@/lib/rto";
import { runtimeId } from "../ids";
import { alphaRef, invoiceReferenceNumber, nextNumber, numericRef } from "../numbering";
import { deleteRow, insertRow, readCollection, readMany, updateRow } from "../store";
import { BODY_TYPES, ORDER_VARIANTS, RTO_CLASSES, type Approval, type Booking, type Payment, type Product, type Quotation, type QuoteLine, type WorkflowEvent } from "../types";
import { queueVoucher } from "../workflows/ledger";
import { sendMessage } from "../workflows/messaging";
import { shareWithCustomer } from "../workflows/quotes";
import { dateField, gone, isId, int, num, oneOf, phoneField, refresh, str, type Prev } from "./input";
import { saving } from "./outcome";

/**
 * Quotation & GST invoicing — every write.
 *
 * A quotation is built off the price list, taxed by place of supply, and
 * carries the PM E-DRIVE incentive where the model earns it. Sending one with
 * a discount above the limit raises a Discount approval instead; the decision
 * (ERP → Approvals) sends it on or returns it to draft. An accepted quotation
 * converts into a booking without re-keying anything, and the tax invoice is
 * issued from it at delivery.
 */

const DAY = 86_400_000;
const MAX_ACCESSORIES = 5;

const event = (status: string, note?: string): WorkflowEvent => ({ status, at: new Date().toISOString(), by: OPERATOR.name, ...(note ? { note } : {}) });

async function findQuote(id: string) {
  if (!isId(id)) return null;
  const { rows } = await readCollection("quotations");
  return rows.find((q) => q.id === id) ?? null;
}

export async function createQuotation(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const out: { quote?: Quotation } = {};
  const result = await saving(async () => {
    const { data } = await readMany(["dealers", "products", "quotations", "deals"] as const);

    const dealer = data.dealers.find((d) => d.name === str(fd, "dealer"));
    if (!dealer || dealer.status === "Suspended") return failed("Choose an active dealer");
    const customer = str(fd, "customer", 120);
    if (!customer) return failed("Enter the customer's name");
    const phone = phoneField(fd, "phone");
    if (!phone) return failed("Enter a valid 10-digit mobile number");
    const customerState = str(fd, "customerState");
    if (!INDIAN_STATES.includes(customerState)) return failed("Choose the customer's state", "It decides CGST + SGST or IGST.");

    const gstinRaw = str(fd, "customerGstin", 20).toUpperCase();
    if (gstinRaw && !isValidGstin(gstinRaw)) return failed("That GSTIN is not valid", "Check the 15 characters — the last one is a check digit.");
    if (gstinRaw && stateOfGstin(gstinRaw) !== customerState) {
      return failed("The GSTIN is registered in another state", `${gstinRaw.slice(0, 2)} is ${stateOfGstin(gstinRaw)}; a B2B supply's place of supply is the buyer's registered state.`);
    }

    // One picker carries both, as "model::variant".
    const [modelName, variantName] = str(fd, "vehicle").split("::");
    const product = data.products.find((p) => p.model === modelName && p.active);
    if (!product) return failed("Choose a model from the price list");
    const variant = product.variants.find((v) => v.variant === variantName);
    if (!variant) return failed(`Choose a variant ${product.model} is priced in`);
    const quantity = int(fd, "quantity", 1, 100);
    if (quantity === null) return failed("Quantity must be a whole number from 1 to 100");

    const unitTaxable = Math.round(variant.exShowroom / (1 + GST_RATE_VEHICLE / 100));
    const lines: QuoteLine[] = [
      {
        kind: "Vehicle",
        description: `${product.model} ${variant.variant}`,
        model: product.model,
        variant: variant.variant,
        hsn: product.hsn,
        quantity,
        unitPrice: unitTaxable,
        gstRate: GST_RATE_VEHICLE,
      },
    ];

    const warrantyYears = str(fd, "extendedWarranty");
    if (EXTENDED_WARRANTY_PCT[warrantyYears]) {
      lines.push({
        kind: "Extended Warranty",
        description: `Extended warranty — ${warrantyYears} year${warrantyYears === "1" ? "" : "s"} beyond the standard cover`,
        hsn: HSN.extendedWarranty,
        quantity,
        unitPrice: Math.round((unitTaxable * EXTENDED_WARRANTY_PCT[warrantyYears]) / 100),
        gstRate: GST_RATE_STANDARD,
      });
    }

    const descriptions = fd.getAll("accDesc").map((v) => String(v).trim().slice(0, 80));
    const qtys = fd.getAll("accQty").map(Number);
    const prices = fd.getAll("accPrice").map(Number);
    let accessories = 0;
    for (let i = 0; i < descriptions.length; i++) {
      if (!descriptions[i]) continue;
      if (++accessories > MAX_ACCESSORIES) return failed(`At most ${MAX_ACCESSORIES} accessory lines`);
      const q = qtys[i];
      const p = prices[i];
      if (!Number.isInteger(q) || q < 1 || q > 500) return failed(`Accessory "${descriptions[i]}": quantity must be 1–500`);
      if (!Number.isFinite(p) || p < 1 || p > 500_000) return failed(`Accessory "${descriptions[i]}": price must be ₹1–₹5,00,000`);
      lines.push({ kind: "Accessory", description: descriptions[i], hsn: HSN.accessory, quantity: q, unitPrice: Math.round(p), gstRate: GST_RATE_STANDARD });
    }

    if (fd.get("includeRegistration")) {
      lines.push({
        kind: "Registration & HSRP",
        description: "RTO registration (fee exempt for battery vehicles) and HSRP plates — collected for the RTO",
        hsn: HSN.passThrough,
        quantity,
        unitPrice: RTO_FEES.registration + RTO_FEES.roadTax + RTO_FEES.hsrp,
        gstRate: 0,
      });
    }
    if (fd.get("includeInsurance")) {
      const cheapest = quoteInsurance(idvFor(variant.exShowroom), product.rtoClass, "Comprehensive")[0];
      lines.push({
        kind: "Insurance",
        description: `First-year comprehensive insurance, indicative (${cheapest.insurer}) — collected for the insurer`,
        hsn: HSN.passThrough,
        quantity,
        unitPrice: cheapest.premium,
        gstRate: 0,
      });
    }

    const vehicleValue = unitTaxable * quantity;
    const discount = num(fd, "discount", 0, vehicleValue) ?? (str(fd, "discount") ? -1 : 0);
    if (discount < 0) return failed("The discount must be between ₹0 and the vehicle value");

    let deal = null;
    const dealId = str(fd, "dealId", 64);
    if (dealId) {
      deal = data.deals.find((d) => d.id === dealId) ?? null;
      if (!deal) return failed("That deal no longer exists");
    }

    const now = new Date();
    const quote: Quotation = {
      id: runtimeId("QT"),
      quoteNo: nextNumber(data.quotations.map((q) => q.quoteNo), "QT", 3000),
      dealer: dealer.name,
      dealerState: dealer.state,
      customer,
      phone,
      customerGstin: gstinRaw || null,
      customerState,
      dealId: deal?.id ?? null,
      leadId: deal?.leadId ?? null,
      lines,
      discount: Math.round(discount),
      subsidy: pmEDriveIncentive(product, variant, now) * quantity,
      status: "Draft",
      approvalId: null,
      bookingId: null,
      validUntil: new Date(now.getTime() + QUOTE_VALID_DAYS * DAY).toISOString(),
      createdAt: now.toISOString(),
      createdBy: OPERATOR.name,
      history: [event("Draft", `${quantity} × ${product.model} ${variant.variant}`)],
    };
    await insertRow("quotations", quote);
    if (deal && DEAL_STAGES_BEFORE_QUOTATION.includes(deal.stage)) await updateRow("deals", deal.id, { stage: "Quotation", ageingDays: 0 });
    out.quote = quote;
    refresh();
    return succeeded(`Quotation ${quote.quoteNo} drafted`);
  });
  // Straight to the new quotation — its page shows the full tax breakdown.
  if (out.quote) redirect(`/dms/quotations/${out.quote.id}?created=${encodeURIComponent(out.quote.quoteNo)}`);
  return result;
}

export async function reviseQuotation(quoteId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const q = await findQuote(quoteId);
    if (!q) return gone("quotation");
    const status = quoteStatus(q);
    if (!["Draft", "Sent", "Pending Approval", "Expired"].includes(status)) return failed(`A ${status.toLowerCase()} quotation can't be revised`);

    const totals = quoteTotals(q);
    const discount = num(fd, "discount", 0, totals.vehicleValue);
    if (discount === null) return failed("The discount must be between ₹0 and the vehicle value");
    const validUntil = dateField(fd, "validUntil");
    if (validUntil && new Date(validUntil).getTime() < Date.now()) return failed("The new validity date must be in the future");

    const patch: Partial<Quotation> = { discount: Math.round(discount), status: "Draft", history: [...q.history, event("Revised", `Discount ${rupees(discount)}`)] };
    if (validUntil) patch.validUntil = validUntil;
    else if (status === "Expired") patch.validUntil = new Date(Date.now() + QUOTE_VALID_DAYS * DAY).toISOString();

    // A pending discount request is moot once the discount changes.
    if (q.approvalId) {
      const { rows: approvals } = await readCollection("approvals");
      const approval = approvals.find((a) => a.id === q.approvalId);
      if (approval && (approval.status ?? "Pending") === "Pending") {
        await updateRow("approvals", approval.id, { status: "Rejected", decidedBy: OPERATOR.name, decidedAt: new Date().toISOString(), note: "Withdrawn — the quotation was revised" });
      }
      if (approval?.status !== "Approved" || Math.round(discount) !== q.discount) patch.approvalId = null;
    }
    await updateRow("quotations", q.id, patch);
    refresh();
    return succeeded(`${q.quoteNo} revised`, "Back in draft — send it again when ready.");
  });
}

/** Shares a draft with the customer — or, when the discount is over the limit, asks for approval first. */
export async function sendQuotation(quoteId: string): Promise<ActionResult> {
  return saving(async () => {
    const q = await findQuote(quoteId);
    if (!q) return gone("quotation");
    const status = quoteStatus(q);
    if (status === "Expired") return failed("This quotation has expired", "Revise it to extend its validity.");
    if (status !== "Draft") return failed(`Already ${status.toLowerCase()}`);

    const totals = quoteTotals(q);
    const { rows: approvals } = await readCollection("approvals");
    const approved = q.approvalId && approvals.find((a) => a.id === q.approvalId)?.status === "Approved";

    if (totals.needsApproval && !approved) {
      const units = quoteUnits(q);
      const vehicle = q.lines.find((l) => l.kind === "Vehicle");
      const approval: Approval = {
        id: runtimeId("APR"),
        type: "Discount",
        subject: `${q.quoteNo} · ${q.customer}`,
        requestedBy: OPERATOR.name,
        pendingWith: "Regional Sales Manager",
        raisedAt: new Date().toISOString(),
        ageingHours: 0,
        status: "Pending",
        link: { kind: "quotation", id: q.id },
        detail: `${totals.discountPct}% (${rupees(q.discount)}) off ${units} × ${vehicle?.description ?? "vehicle"} — the limit is ${DISCOUNT_LIMIT_PCT}%`,
      };
      await insertRow("approvals", approval);
      await updateRow("quotations", q.id, {
        status: "Pending Approval",
        approvalId: approval.id,
        history: [...q.history, event("Pending Approval", approval.detail ?? undefined)],
      });
      refresh();
      return succeeded("Sent for discount approval", `${totals.discountPct}% is over the ${DISCOUNT_LIMIT_PCT}% limit — it goes to the customer once approved.`);
    }

    await shareWithCustomer(q, totals.payable);
    refresh();
    return succeeded(`${q.quoteNo} sent to ${q.customer}`, "Shared on WhatsApp.");
  });
}

export async function markQuotationAccepted(quoteId: string): Promise<ActionResult> {
  return saving(async () => {
    const q = await findQuote(quoteId);
    if (!q) return gone("quotation");
    const status = quoteStatus(q);
    if (status !== "Sent") return failed(status === "Expired" ? "This quotation has expired" : "Only a quotation with the customer can be accepted");
    await updateRow("quotations", q.id, { status: "Accepted", history: [...q.history, event("Accepted")] });
    refresh();
    return succeeded(`${q.customer} accepted ${q.quoteNo}`, "Convert it to a booking to take the token.");
  });
}

/** A draft raised by mistake. Once it has been sent or approved it is declined, not erased. */
export async function deleteQuotation(quoteId: string): Promise<ActionResult> {
  return saving(async () => {
    const q = await findQuote(quoteId);
    if (!q) return gone("quotation");
    if (q.status !== "Draft") return failed(`A ${q.status.toLowerCase()} quotation can't be deleted`, "Decline it instead — the customer has already seen it.");
    if (q.approvalId) return failed("This quotation is with an approver", "Let the discount approval finish first.");
    await deleteRow("quotations", quoteId);
    refresh();
    return succeeded(`${q.quoteNo} deleted`, q.customer);
  });
}

export async function declineQuotation(quoteId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const q = await findQuote(quoteId);
    if (!q) return gone("quotation");
    const reason = str(fd, "reason", 300);
    if (reason.length < 3) return failed("Say why the quotation was declined");
    if (q.status === "Converted" || q.status === "Rejected") return failed(`Already ${q.status.toLowerCase()}`);
    await updateRow("quotations", q.id, { status: "Rejected", history: [...q.history, event("Rejected", reason)] });
    refresh();
    return succeeded(`${q.quoteNo} marked declined`, reason);
  });
}

/** Accepted quotation → booking: the quantity, price and customer carry across, and a payment link goes out for the token. */
export async function convertQuotation(quoteId: string): Promise<ActionResult> {
  return saving(async () => {
    const q = await findQuote(quoteId);
    if (!q) return gone("quotation");
    if (q.status !== "Accepted") return failed("Only an accepted quotation converts to a booking");

    const { data } = await readMany(["bookings", "deals", "payments"] as const);
    const totals = quoteTotals(q);
    const units = quoteUnits(q);
    const model = q.lines.find((l) => l.kind === "Vehicle")?.model ?? "Vehicle";
    const token = Math.round((totals.payable * TOKEN_PCT) / 100 / 100) * 100;
    const now = new Date();

    const booking: Booking = {
      id: runtimeId("BKG"),
      bookingNo: nextNumber(data.bookings.map((b) => b.bookingNo), "BKG", 4100),
      dealId: q.dealId,
      customer: q.customer,
      dealer: q.dealer,
      model,
      token,
      total: totals.payable,
      status: "Confirmed",
      bookedAt: now.toISOString(),
      deliveryEta: new Date(now.getTime() + 14 * DAY).toISOString(),
      vehicleUnitId: null,
      quantity: units,
      unitPrice: Math.round(totals.payable / Math.max(1, units)),
      phone: q.phone,
      quotationId: q.id,
    };
    await insertRow("bookings", booking);
    await updateRow("quotations", q.id, { status: "Converted", bookingId: booking.id, history: [...q.history, event("Converted", `Booking ${booking.bookingNo}`)] });

    const deal = q.dealId ? data.deals.find((d) => d.id === q.dealId) : undefined;
    if (deal) await updateRow("deals", deal.id, { stage: "Booked", bookingId: booking.id, ageingDays: 0 });
    if (q.leadId) await updateRow("leads", q.leadId, { status: "Converted", updatedAt: now.toISOString() });

    const payment: Payment = {
      id: runtimeId("PAY"),
      gatewayRef: `plink_${alphaRef(14)}`,
      purpose: "Booking Token",
      payer: q.customer,
      amount: token,
      method: "UPI",
      status: "Created",
      fee: 0,
      related: { kind: "booking", id: booking.id, label: booking.bookingNo },
      createdAt: now.toISOString(),
      capturedAt: null,
      settledAt: null,
    };
    await insertRow("payments", payment);
    await sendMessage({
      channel: "WhatsApp",
      template: "booking_confirmation",
      to: q.phone,
      customer: q.customer,
      vars: [q.customer, booking.bookingNo, `${units} × ${model}`, rupees(token)],
      related: { kind: "booking", id: booking.id, label: booking.bookingNo },
    });
    refresh();
    return succeeded(`Booking ${booking.bookingNo} created`, `Token of ${rupees(token)} requested by payment link.`);
  });
}

// ---------------------------------------------------------------------------
// Price list
// ---------------------------------------------------------------------------

const SEGMENTS = ["L3", "L5"] as const;

/**
 * A model new to the price list, with its first variant. HSN follows the body
 * type — passenger vehicles and goods vehicles are taxed under different
 * headings — so an invoice for it is right from the first quotation.
 */
export async function createProduct(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const model = str(fd, "model", 60);
    if (!model) return failed("Name the model");
    const segment = oneOf(fd, "segment", SEGMENTS);
    if (!segment) return failed("L3 or L5?");
    const bodyType = oneOf(fd, "bodyType", BODY_TYPES);
    if (!bodyType) return failed("Choose the body type");
    const rtoClass = oneOf(fd, "rtoClass", RTO_CLASSES);
    if (!rtoClass) return failed("Choose the RTO class");
    const variant = oneOf(fd, "variant", ORDER_VARIANTS);
    if (!variant) return failed("Choose the first variant");
    const exShowroom = int(fd, "exShowroom", 10_000, 10_000_000);
    const dealerPrice = int(fd, "dealerPrice", 10_000, 10_000_000);
    if (exShowroom === null || dealerPrice === null) return failed("Prices must be whole rupees between ₹10,000 and ₹1 Cr");
    if (dealerPrice >= exShowroom / (1 + GST_RATE_VEHICLE / 100)) return failed("The dealer price must be below the ex-showroom price before GST", "Otherwise the dealer sells at a loss.");
    const batteryKwh = num(fd, "batteryKwh", 1, 30);
    if (batteryKwh === null) return failed("Battery energy must be between 1 and 30 kWh");

    const { rows } = await readCollection("products");
    if (rows.some((p) => p.model.toLowerCase() === model.toLowerCase())) return failed(`${model} is already on the price list`);

    const product: Product = {
      id: runtimeId("PRD"),
      model,
      segment,
      bodyType,
      rtoClass,
      hsn: bodyType === "Passenger" ? HSN.passengerVehicle : HSN.goodsVehicle,
      motor: str(fd, "motor", 60) || "BLDC",
      battery: str(fd, "battery", 60) || `${batteryKwh} kWh lithium`,
      range: str(fd, "range", 40) || "—",
      capacity: str(fd, "capacity", 40) || "—",
      warranty: str(fd, "warranty", 60) || "1 year / 15,000 km",
      // PM E-DRIVE money is L3 only, and only while the window is open.
      subsidyEligible: segment === "L3" && fd.get("subsidyEligible") === "on",
      variants: [{ variant, exShowroom, dealerPrice, batteryKwh }],
      active: true,
      updatedAt: new Date().toISOString(),
    };
    await insertRow("products", product);
    refresh();
    return succeeded(`${model} added to the price list`, `${variant} at ${rupees(exShowroom)} ex-showroom`);
  });
}

/** The published specification. HSN follows the body type, so it is recomputed here too. */
export async function updateProduct(productId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(productId)) return gone("model");
    const { data } = await readMany(["products", "quotations", "orders", "vehicle_units"] as const);
    const product = data.products.find((p) => p.id === productId);
    if (!product) return gone("model");

    const model = str(fd, "model", 60);
    if (!model) return failed("Name the model");
    if (data.products.some((p) => p.id !== productId && p.model.toLowerCase() === model.toLowerCase())) return failed(`${model} is already on the price list`);
    // Quotations, orders and stock all carry the model by name, so a name in
    // use cannot change under them — the specification still can.
    if (model !== product.model) {
      const used =
        (data.quotations.some((q) => q.lines.some((line) => line.model === product.model)) && "quotations") ||
        (data.orders.some((o) => (o.lines ?? []).some((line) => line.model === product.model)) && "dealer orders") ||
        (data.vehicle_units.some((v) => v.model === product.model) && "vehicles in stock");
      if (used) return failed(`${product.model} is on ${used}`, "Its specification can still be edited — only the name is fixed once it has been sold against.");
    }
    const segment = oneOf(fd, "segment", SEGMENTS);
    if (!segment) return failed("L3 or L5?");
    const bodyType = oneOf(fd, "bodyType", BODY_TYPES);
    if (!bodyType) return failed("Choose the body type");
    const rtoClass = oneOf(fd, "rtoClass", RTO_CLASSES);
    if (!rtoClass) return failed("Choose the RTO class");

    await updateRow("products", productId, {
      model,
      segment,
      bodyType,
      rtoClass,
      hsn: bodyType === "Passenger" ? HSN.passengerVehicle : HSN.goodsVehicle,
      motor: str(fd, "motor", 60) || product.motor,
      battery: str(fd, "battery", 60) || product.battery,
      range: str(fd, "range", 40) || product.range,
      capacity: str(fd, "capacity", 40) || product.capacity,
      warranty: str(fd, "warranty", 60) || product.warranty,
      subsidyEligible: segment === "L3" && fd.get("subsidyEligible") === "on",
      updatedAt: new Date().toISOString(),
    });
    refresh();
    return succeeded(`${model} updated`, `${segment} ${bodyType} · HSN ${bodyType === "Passenger" ? HSN.passengerVehicle : HSN.goodsVehicle}`);
  });
}

/** A model nothing has been quoted or ordered against. Otherwise take it off the list. */
export async function deleteProduct(productId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(productId)) return gone("model");
    const { data } = await readMany(["products", "quotations", "orders", "vehicle_units"] as const);
    const product = data.products.find((p) => p.id === productId);
    if (!product) return gone("model");
    const used =
      (data.quotations.some((q) => q.lines.some((line) => line.model === product.model)) && "quotations") ||
      (data.orders.some((o) => (o.lines ?? []).some((line) => line.model === product.model)) && "dealer orders") ||
      (data.vehicle_units.some((v) => v.model === product.model) && "vehicles in stock");
    if (used) return failed(`${product.model} is on ${used}`, "Take it off the price list instead — what is already sold keeps its prices.");
    await deleteRow("products", productId);
    refresh();
    return succeeded(`${product.model} removed from the price list`);
  });
}

export async function updateVariantPrice(productId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(productId)) return gone("model");
    const { rows } = await readCollection("products");
    const product = rows.find((p) => p.id === productId);
    if (!product) return gone("model");
    const variantName = str(fd, "variant");
    if (!(ORDER_VARIANTS as readonly string[]).includes(variantName)) return failed("Choose a variant");
    const exShowroom = int(fd, "exShowroom", 10_000, 10_000_000);
    const dealerPrice = int(fd, "dealerPrice", 10_000, 10_000_000);
    if (exShowroom === null || dealerPrice === null) return failed("Prices must be whole rupees between ₹10,000 and ₹1 Cr");
    if (dealerPrice >= exShowroom / (1 + GST_RATE_VEHICLE / 100)) return failed("The dealer price must be below the ex-showroom price before GST", "Otherwise the dealer sells at a loss.");
    const batteryKwh = num(fd, "batteryKwh", 1, 30);
    if (batteryKwh === null) return failed("Battery energy must be between 1 and 30 kWh");

    const existing = product.variants.find((v) => v.variant === variantName);
    const updated = { variant: variantName as (typeof ORDER_VARIANTS)[number], exShowroom, dealerPrice, batteryKwh };
    const variants = existing ? product.variants.map((v) => (v.variant === variantName ? updated : v)) : [...product.variants, updated];
    await updateRow("products", product.id, { variants, updatedAt: new Date().toISOString() });
    refresh();
    return succeeded(`${product.model} ${variantName} repriced`, `${rupees(exShowroom)} ex-showroom · dealer ${rupees(dealerPrice)}`);
  });
}

export async function setProductActive(productId: string, activeArg: unknown): Promise<ActionResult> {
  return saving(async () => {
    // Bound arguments arrive from the browser like any other input.
    const active = activeArg === true;
    if (!isId(productId) || !(await updateRow("products", productId, { active, updatedAt: new Date().toISOString() }))) return gone("model");
    refresh();
    return succeeded(active ? "Back on the price list" : "Taken off the price list", active ? "It can be quoted again." : "Existing quotations keep their prices.");
  });
}

// ---------------------------------------------------------------------------
// Tax invoices
// ---------------------------------------------------------------------------

/** IRN cancellation is only possible within 24 hours of generation; after that a credit note is the way. */
export async function cancelTaxInvoice(invoiceId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(invoiceId)) return gone("invoice");
    const reason = str(fd, "reason", 300);
    if (reason.length < 3) return failed("Say why the invoice is being cancelled");
    const { rows } = await readCollection("tax_invoices");
    const invoice = rows.find((i) => i.id === invoiceId);
    if (!invoice) return gone("invoice");
    if (invoice.status === "Cancelled") return failed("Already cancelled");
    if (invoice.irn && Date.now() - new Date(invoice.ackAt ?? invoice.issuedAt).getTime() > DAY) {
      return failed("Its IRN is more than 24 hours old", "An e-invoice can only be cancelled within 24 hours — issue a credit note instead.");
    }
    await updateRow("tax_invoices", invoice.id, { status: "Cancelled", cancelReason: reason });
    await queueVoucher({
      voucherType: "Credit Note",
      source: "Retail Invoice",
      sourceId: invoice.id,
      reference: `${invoice.invoiceNo} (cancelled)`,
      party: invoice.customer,
      amount: invoice.total,
      ledgers: ["debtors_retail", "sales_vehicle", ...(invoice.igst ? (["output_igst"] as const) : (["output_cgst", "output_sgst"] as const))],
    });
    refresh();
    return succeeded(`${invoice.invoiceNo} cancelled`, reason);
  });
}

/** Generates the IRN for a B2B invoice issued while the IRP was unreachable. */
export async function generateIrn(invoiceId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(invoiceId)) return gone("invoice");
    const { data } = await readMany(["tax_invoices", "connectors"] as const);
    const invoice = data.tax_invoices.find((i) => i.id === invoiceId);
    if (!invoice) return gone("invoice");
    if (!invoice.customerGstin) return failed("A B2C invoice takes no IRN");
    if (invoice.irn) return failed("It already has its IRN");
    if (invoice.status !== "Issued") return failed("The invoice is cancelled");
    if (data.connectors.find((c) => c.key === "gst_irp")?.status !== "Connected") return failed("The IRP is not connected", "Reconnect it under API Integrations.");
    const now = new Date();
    await updateRow("tax_invoices", invoice.id, { irn: invoiceReferenceNumber(invoice.dealerGstin, invoice.invoiceNo, now), ackNo: numericRef(15), ackAt: now.toISOString() });
    refresh();
    return succeeded(`IRN generated for ${invoice.invoiceNo}`);
  });
}
