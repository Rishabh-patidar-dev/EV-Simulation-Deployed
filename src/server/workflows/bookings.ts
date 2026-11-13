import "server-only";
import { OPERATOR } from "@/lib/operator";
import { runtimeId } from "../ids";
import { nextNumber } from "../numbering";
import { insertRow, readMany, updateRow } from "../store";
import type { Booking, Delivery } from "../types";

/**
 * What happens around a booking as it moves — shared by Bookings, Finance &
 * Insurance and Vehicle Delivery so each path does the same thing.
 */

const DAY = 86_400_000;

/** Vehicles on a booking. Older rows have no quantity: one vehicle. */
const bookingUnits = (b: Pick<Booking, "quantity">) => Math.max(1, b.quantity ?? 1);

/** Loan statuses that still hold the booking up. */
export const ACTIVE_LOAN = ["Applied", "Under Review", "Sanctioned"] as const;

/**
 * Opens the delivery for a booking that is ready — once. Returns the delivery,
 * new or existing.
 */
export async function openDelivery(booking: Booking): Promise<Delivery> {
  const { data } = await readMany(["deliveries"] as const);
  const existing = data.deliveries.find((d) => d.bookingId === booking.id && d.status !== "Cancelled");
  if (existing) return existing;

  const at = new Date().toISOString();
  const delivery: Delivery = {
    id: runtimeId("DLV"),
    deliveryNo: nextNumber(data.deliveries.map((d) => d.deliveryNo), "DLV", 6000),
    bookingId: booking.id,
    bookingNo: booking.bookingNo,
    customer: booking.customer,
    phone: booking.phone ?? "",
    dealer: booking.dealer,
    model: booking.model,
    quantity: bookingUnits(booking),
    vehicles: [],
    scheduledFor: booking.deliveryEta && new Date(booking.deliveryEta).getTime() > Date.now() ? booking.deliveryEta : new Date(Date.now() + 3 * DAY).toISOString(),
    gatePassNo: null,
    ewayBillNo: null,
    dispatchedAt: null,
    handoverOtp: null,
    handover: null,
    status: "Scheduled",
    taxInvoiceId: null,
    createdAt: at,
    history: [{ status: "Scheduled", at, by: OPERATOR.name, note: `Opened for booking ${booking.bookingNo}` }],
  };
  await insertRow("deliveries", delivery);
  return delivery;
}

/**
 * Cancels a booking and unwinds what hung off it: allocated vehicles go back
 * into stock, an open delivery is cancelled, an unfinished loan is withdrawn
 * and issued policies are cancelled. A delivered booking cannot be cancelled.
 */
export async function cancelBookingCascade(booking: Booking, reason: string): Promise<string[]> {
  const { data } = await readMany(["vehicle_units", "deliveries", "finance_cases", "insurance_policies"] as const);
  const at = new Date().toISOString();
  const done: string[] = [];

  const units = data.vehicle_units.filter((u) => u.bookingId === booking.id && u.status === "Allocated");
  for (const u of units) await updateRow("vehicle_units", u.id, { status: "In Stock", bookingId: null });
  if (units.length) done.push(`${units.length} vehicle${units.length === 1 ? "" : "s"} back in stock`);

  for (const d of data.deliveries.filter((x) => x.bookingId === booking.id && x.status !== "Handed Over" && x.status !== "Cancelled")) {
    await updateRow("deliveries", d.id, { status: "Cancelled", history: [...d.history, { status: "Cancelled", at, by: OPERATOR.name, note: reason }] });
    done.push(`delivery ${d.deliveryNo} cancelled`);
  }
  for (const c of data.finance_cases.filter((x) => x.bookingId === booking.id && (ACTIVE_LOAN as readonly string[]).includes(x.status))) {
    await updateRow("finance_cases", c.id, { status: "Withdrawn", history: [...c.history, { status: "Withdrawn", at, by: OPERATOR.name, note: `Booking cancelled — ${reason}` }] });
    done.push(`loan ${c.caseNo} withdrawn`);
  }
  const policies = data.insurance_policies.filter((p) => p.bookingId === booking.id && p.status === "Issued");
  for (const p of policies) await updateRow("insurance_policies", p.id, { status: "Cancelled" });
  if (policies.length) done.push(`${policies.length} polic${policies.length === 1 ? "y" : "ies"} cancelled`);

  await updateRow("bookings", booking.id, { status: "Cancelled" });
  return done;
}
