"use server";

import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { GST_RATE_VEHICLE, HSN, rupees } from "@/lib/gst";
import { OPERATOR } from "@/lib/operator";
import { RTO_FEES, RTO_STATE_CODES, TP_VALID_DAYS, rtoOffice } from "@/lib/rto";
import { runtimeId } from "../ids";
import { numberSeries, numericRef } from "../numbering";
import { insertRow, readMany, updateRow } from "../store";
import { PDI_CHECKS, RTO_DOCUMENTS, type Delivery, type DeliveryVehicle, type QuoteLine, type Registration, type TelematicsDevice, type WorkflowEvent } from "../types";
import { openDelivery } from "../workflows/bookings";
import { issueTaxInvoice } from "../workflows/invoicing";
import { sendMessage } from "../workflows/messaging";
import { logMovement } from "../workflows/stock";
import { dateField, gone, int, isId, refresh, str, ticked, type Prev } from "./input";
import { saving } from "./outcome";

/**
 * Vehicle delivery — the last mile of a booking, per chassis.
 *
 * Scheduled → vehicles allocated off stock and each one through the PDI →
 * PDI Done → insured, gate pass and e-way bill raised, handover OTP sent →
 * Dispatched → OTP confirmed at the customer → Handed Over. The handover is
 * where the booking completes: stock is booked out, the GST tax invoice is
 * issued, every vehicle gets its temporary registration and RTO file, and
 * its telematics unit comes online.
 */

const DAY = 86_400_000;
const event = (status: string, note?: string): WorkflowEvent => ({ status, at: new Date().toISOString(), by: OPERATOR.name, ...(note ? { note } : {}) });

async function loadDelivery(deliveryId: string) {
  if (!isId(deliveryId)) return null;
  const { data } = await readMany(["deliveries"] as const);
  return data.deliveries.find((d) => d.id === deliveryId) ?? null;
}

const closed = (d: Delivery) => d.status === "Handed Over" || d.status === "Cancelled";

/** For a booking that was made ready before deliveries were tracked. */
export async function openDeliveryForBooking(bookingId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(bookingId)) return gone("booking");
    const { data } = await readMany(["bookings"] as const);
    const booking = data.bookings.find((b) => b.id === bookingId);
    if (!booking) return gone("booking");
    if (booking.status !== "Ready for Delivery") return failed("Only a booking that is ready for delivery can be scheduled");
    const delivery = await openDelivery(booking);
    refresh();
    return succeeded(`Delivery ${delivery.deliveryNo} opened`, `${delivery.quantity} × ${delivery.model} for ${delivery.customer}.`);
  });
}

export async function allocateVehicles(deliveryId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const d = await loadDelivery(deliveryId);
    if (!d) return gone("delivery");
    if (d.status !== "Scheduled") return failed("Vehicles are allocated before the PDI is complete");
    const needed = d.quantity - d.vehicles.length;
    if (needed <= 0) return failed("Every vehicle on this booking is allocated");

    const { data } = await readMany(["vehicle_units"] as const);
    const available = data.vehicle_units
      // Vehicles reserved to a dealer order are spoken for.
      .filter((u) => u.model === d.model && (u.status === "In Stock" || (u.status === "Allocated" && !u.bookingId && !u.orderId)))
      // Oldest stock first — ageing stock is what a dealer wants moving.
      .sort((a, b) => b.ageingDays - a.ageingDays);

    const picked = fd.get("auto") ? available.slice(0, needed) : available.filter((u) => ticked(fd, "unit").has(u.id));
    if (!picked.length) return failed(available.length ? "Tick the vehicles to allocate" : `No ${d.model} in stock`, available.length ? undefined : "Raise a dealer order in Order Management.");
    if (picked.length > needed) return failed(`Only ${needed} more vehicle${needed === 1 ? "" : "s"} needed`);

    const vehicles: DeliveryVehicle[] = [
      ...d.vehicles,
      ...picked.map((u) => ({ vehicleUnitId: u.id, vin: u.vin, variant: u.variant, pdi: PDI_CHECKS.map(() => false), pdiBy: null, pdiAt: null })),
    ];
    for (const u of picked) await updateRow("vehicle_units", u.id, { status: "Allocated", bookingId: d.bookingId });
    await updateRow("deliveries", d.id, { vehicles, history: [...d.history, event("Allocated", picked.map((u) => u.vin).join(", "))] });
    refresh();
    const short = d.quantity - vehicles.length;
    return succeeded(`${picked.length} vehicle${picked.length === 1 ? "" : "s"} allocated`, short ? `${short} still to allocate.` : "Run the PDI on each chassis next.");
  });
}

export async function releaseVehicle(deliveryId: string, vehicleUnitId: string): Promise<ActionResult> {
  return saving(async () => {
    const d = await loadDelivery(deliveryId);
    if (!d) return gone("delivery");
    if (d.status !== "Scheduled") return failed("A vehicle can only be released before the PDI is signed off");
    const v = d.vehicles.find((x) => x.vehicleUnitId === vehicleUnitId);
    if (!v) return failed("That vehicle is not on this delivery");
    await updateRow("vehicle_units", v.vehicleUnitId, { status: "In Stock", bookingId: null });
    await updateRow("deliveries", d.id, { vehicles: d.vehicles.filter((x) => x.vehicleUnitId !== vehicleUnitId), history: [...d.history, event("Released", v.vin)] });
    refresh();
    return succeeded(`${v.vin} back in stock`);
  });
}

/** Saves one chassis's PDI; when every chassis passes and all are allocated, the delivery moves to PDI Done. */
export async function recordPdi(deliveryId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const d = await loadDelivery(deliveryId);
    if (!d) return gone("delivery");
    if (d.status !== "Scheduled") return failed("The PDI is already signed off");
    const unitId = str(fd, "vehicleUnitId", 64);
    const v = d.vehicles.find((x) => x.vehicleUnitId === unitId);
    if (!v) return failed("That vehicle is not on this delivery");

    const checks = ticked(fd, "check");
    const pdi = PDI_CHECKS.map((_, i) => checks.has(String(i)));
    const passed = pdi.every(Boolean);
    const at = new Date().toISOString();
    const vehicles = d.vehicles.map((x) => (x.vehicleUnitId === unitId ? { ...x, pdi, pdiBy: passed ? OPERATOR.name : null, pdiAt: passed ? at : null } : x));
    const allDone = vehicles.length === d.quantity && vehicles.every((x) => x.pdiAt);
    await updateRow("deliveries", d.id, {
      vehicles,
      status: allDone ? "PDI Done" : "Scheduled",
      history: allDone ? [...d.history, event("PDI Done", `${vehicles.length} vehicle${vehicles.length === 1 ? "" : "s"} passed`)] : d.history,
    });
    refresh();
    if (!passed) return succeeded(`PDI saved for ${v.vin}`, `${pdi.filter((x) => !x).length} check${pdi.filter((x) => !x).length === 1 ? "" : "s"} still open — fix and re-check before dispatch.`);
    return succeeded(`${v.vin} passed the PDI`, allDone ? "Every vehicle passed — issue insurance, then dispatch." : undefined);
  });
}

/** Gate pass, e-way bill and the handover OTP. Every chassis must be insured before it leaves. */
export async function dispatchDelivery(deliveryId: string): Promise<ActionResult> {
  return saving(async () => {
    const d = await loadDelivery(deliveryId);
    if (!d) return gone("delivery");
    if (d.status !== "PDI Done") return failed(d.status === "Scheduled" ? "Finish the PDI on every vehicle first" : `Already ${d.status.toLowerCase()}`);

    const { data } = await readMany(["insurance_policies", "connectors", "dealers", "bookings"] as const);
    const insured = new Set(data.insurance_policies.filter((p) => p.status === "Issued").map((p) => p.vehicleUnitId));
    const uninsured = d.vehicles.filter((v) => !insured.has(v.vehicleUnitId));
    if (uninsured.length) return failed(`${uninsured.length} vehicle${uninsured.length === 1 ? " is" : "s are"} not insured`, "A vehicle can't leave uninsured — issue the policies under Finance & Insurance.");

    const eway = data.connectors.find((c) => c.key === "eway_bill");
    if (!eway || eway.status !== "Connected") return failed("The e-way bill portal is not connected", "Reconnect it under API Integrations — goods over ₹50,000 cannot move without one.");

    const booking = data.bookings.find((b) => b.id === d.bookingId);
    const dealer = data.dealers.find((x) => x.name === d.dealer);
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const gatePassNo = `GP/${dealer?.code ?? "DLR"}/${numericRef(5)}`;
    const ewayBillNo = numericRef(12);
    await updateRow("deliveries", d.id, {
      status: "Dispatched",
      gatePassNo,
      ewayBillNo,
      dispatchedAt: new Date().toISOString(),
      handoverOtp: otp,
      history: [...d.history, event("Dispatched", `Gate pass ${gatePassNo} · e-way bill ${ewayBillNo}`)],
    });
    const phone = d.phone || booking?.phone;
    let sent = "No mobile on the booking — read the OTP to the customer from the Messages log.";
    if (phone) {
      const message = await sendMessage({
        channel: "WhatsApp",
        template: "delivery_otp",
        to: phone,
        customer: d.customer,
        vars: [otp, d.deliveryNo],
        related: { kind: "delivery", id: d.id, label: d.deliveryNo },
      });
      sent = message.status === "Failed" ? `The OTP message failed (${message.error}) — see API Integrations.` : "The customer has the handover OTP on WhatsApp.";
    }
    refresh();
    return succeeded(`${d.deliveryNo} dispatched`, sent);
  });
}

export async function completeHandover(deliveryId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const d = await loadDelivery(deliveryId);
    if (!d) return gone("delivery");
    if (d.status !== "Dispatched") return failed(d.status === "Handed Over" ? "Already handed over" : "Dispatch it first — that sends the OTP");
    if (str(fd, "otp", 10) !== d.handoverOtp) return failed("That OTP does not match", "Ask the customer for the code sent at dispatch.");
    const acknowledgedBy = str(fd, "acknowledgedBy", 120);
    if (!acknowledgedBy) return failed("Enter who took the vehicles");
    const odometerKm = int(fd, "odometerKm", 0, 500) ?? 0;
    if (!fd.get("photo")) return failed("Take the handover photo first", "It is the customer's acknowledgement on record.");

    const { data } = await readMany(["bookings", "quotations", "products", "dealers", "registrations", "insurance_policies"] as const);
    const booking = data.bookings.find((b) => b.id === d.bookingId);
    if (!booking) return gone("booking");
    const dealer = data.dealers.find((x) => x.name === d.dealer);
    const product = data.products.find((p) => p.model === d.model);
    const at = new Date();
    const vins = d.vehicles.map((v) => v.vin);

    // 1. Stock out, booking complete.
    for (const v of d.vehicles) await updateRow("vehicle_units", v.vehicleUnitId, { status: "Delivered", ageingDays: 0, bookingId: booking.id });
    await logMovement({ entity: "Vehicle", reference: `${booking.bookingNo} · ${d.deliveryNo}`, direction: "OUT", quantity: d.vehicles.length, bucket: "Customer Delivery" });
    await updateRow("bookings", booking.id, { status: "Delivered", vehicleUnitId: d.vehicles[0]?.vehicleUnitId ?? null });
    if (dealer) await updateRow("dealers", dealer.id, { ytdUnits: dealer.ytdUnits + d.vehicles.length });

    // 2. The tax invoice — from the quotation when there is one, otherwise from the booking's price.
    const quote = booking.quotationId ? data.quotations.find((q) => q.id === booking.quotationId) : undefined;
    const lines: QuoteLine[] = quote
      ? quote.lines
      : [
          {
            kind: "Vehicle",
            description: `${d.model}`,
            model: d.model,
            hsn: product?.hsn ?? HSN.passengerVehicle,
            quantity: d.vehicles.length,
            unitPrice: Math.round(booking.total / Math.max(1, d.quantity) / (1 + GST_RATE_VEHICLE / 100)),
            gstRate: GST_RATE_VEHICLE,
          },
        ];
    const invoice = await issueTaxInvoice({
      kind: "Vehicle Sale",
      dealer: d.dealer,
      customer: d.customer,
      customerGstin: quote?.customerGstin ?? null,
      placeOfSupply: quote?.customerState ?? dealer?.state ?? "Maharashtra",
      lines,
      discount: quote?.discount ?? 0,
      subsidy: quote?.subsidy ?? 0,
      quotationId: quote?.id ?? null,
      bookingId: booking.id,
      vins,
      ewayBillNo: d.ewayBillNo,
    });

    // 3. A temporary registration and an RTO file per vehicle.
    const state = dealer?.state ?? "Maharashtra";
    const office = rtoOffice(dealer?.city ?? "Pune", state);
    const nextApp = numberSeries(data.registrations.map((r) => r.appNo), "RTO", 9000);
    const insured = new Set(data.insurance_policies.filter((p) => p.status === "Issued").map((p) => p.vehicleUnitId));
    for (const v of d.vehicles) {
      const registration: Registration = {
        id: runtimeId("REG"),
        appNo: nextApp(),
        bookingId: booking.id,
        deliveryId: d.id,
        vehicleUnitId: v.vehicleUnitId,
        vin: v.vin,
        model: d.model,
        customer: d.customer,
        dealer: d.dealer,
        state,
        rtoOffice: office,
        vehicleClass: product?.rtoClass ?? "e-Rickshaw",
        tpNo: `TP/${RTO_STATE_CODES[state] ?? "XX"}/${String(at.getFullYear()).slice(-2)}/${numericRef(6)}`,
        tpIssuedAt: at.toISOString(),
        tpValidUntil: new Date(at.getTime() + TP_VALID_DAYS * DAY).toISOString(),
        // The dealer issues Form 21 at sale; Form 22 comes from the maker with the vehicle.
        documents: RTO_DOCUMENTS.map((name) => ({
          name,
          ready: name === "Form 21" || name === "Form 22" || name === "Tax Invoice" || (name === "Insurance" && insured.has(v.vehicleUnitId)),
        })),
        vahanAppNo: null,
        submittedAt: null,
        status: "TP Issued",
        objection: null,
        registrationNo: null,
        approvedAt: null,
        hsrpFittedAt: null,
        rcIssuedAt: null,
        fees: { ...RTO_FEES },
        history: [{ status: "TP Issued", at: at.toISOString(), by: OPERATOR.name, note: `Valid ${TP_VALID_DAYS} days` }],
      };
      await insertRow("registrations", registration);

      // 4. The telematics unit comes online with the vehicle.
      const device: TelematicsDevice = {
        id: runtimeId("TEL"),
        imei: `86${numericRef(13)}`,
        vin: v.vin,
        model: d.model,
        customer: d.customer,
        dealer: d.dealer,
        activatedAt: at.toISOString(),
        soc: 96,
        soh: 100,
        odometerKm,
        city: dealer?.city ?? "—",
        lastSeenAt: at.toISOString(),
        status: "Online",
        alerts: [],
      };
      await insertRow("telematics", device);
    }

    await updateRow("deliveries", d.id, {
      status: "Handed Over",
      handoverOtp: null,
      handover: { at: at.toISOString(), acknowledgedBy, odometerKm, photoRef: `IMG-${numericRef(8)}` },
      taxInvoiceId: invoice.id,
      history: [...d.history, event("Handed Over", `Received by ${acknowledgedBy} · OTP verified`)],
    });

    const phone = d.phone || booking.phone;
    if (phone) {
      await sendMessage({
        channel: "WhatsApp",
        template: "delivery_complete",
        to: phone,
        customer: d.customer,
        vars: [d.customer, `${d.vehicles.length} × ${d.model}`, invoice.invoiceNo, rupees(invoice.payable)],
        related: { kind: "delivery", id: d.id, label: d.deliveryNo },
      });
    }
    refresh();
    return succeeded(
      `${d.vehicles.length} × ${d.model} handed over to ${d.customer}`,
      `Tax invoice ${invoice.invoiceNo} issued; ${d.vehicles.length} temporary registration${d.vehicles.length === 1 ? "" : "s"} valid ${TP_VALID_DAYS} days.`
    );
  });
}

export async function rescheduleDelivery(deliveryId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const d = await loadDelivery(deliveryId);
    if (!d) return gone("delivery");
    if (closed(d)) return failed(`A ${d.status.toLowerCase()} delivery can't be rescheduled`);
    const when = dateField(fd, "scheduledFor");
    if (!when || new Date(when).getTime() < Date.now() - DAY) return failed("Choose today or a later date");
    await updateRow("deliveries", d.id, { scheduledFor: when, history: [...d.history, event("Rescheduled", new Date(when).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }))] });
    refresh();
    return succeeded(`${d.deliveryNo} rescheduled`);
  });
}
