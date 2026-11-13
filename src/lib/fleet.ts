/**
 * Vehicles on the road — every delivered unit with who owns it and when it
 * was handed over, pieced together from stock, bookings, deliveries and
 * registrations. Shared by the workshop, service reminders and telematics so
 * they all agree on whose vehicle is whose.
 */

import { nextService, type ServiceDue } from "@/lib/service";
import type { Booking, Delivery, JobCard, Registration, VehicleUnit } from "@/server/types";

interface OnRoadVehicle {
  unit: VehicleUnit;
  customer: string;
  phone: string | null;
  dealer: string;
  registrationNo: string | null;
  deliveredAt: string;
  bookingId: string | null;
  next: ServiceDue;
  /** Free services already done on closed job cards. */
  freeServicesDone: number;
}

export function vehiclesOnRoad(data: {
  vehicle_units: VehicleUnit[];
  bookings: Booking[];
  deliveries: Delivery[];
  registrations: Registration[];
  job_cards: JobCard[];
}): OnRoadVehicle[] {
  const out: OnRoadVehicle[] = [];
  for (const unit of data.vehicle_units) {
    if (unit.status !== "Delivered") continue;
    const booking = data.bookings.find((b) => b.id === unit.bookingId) ?? data.bookings.find((b) => b.vehicleUnitId === unit.id);
    const delivery = data.deliveries.find((d) => d.status === "Handed Over" && d.vehicles.some((v) => v.vehicleUnitId === unit.id));
    const registration = data.registrations.find((r) => r.vehicleUnitId === unit.id);
    const deliveredAt = delivery?.handover?.at ?? registration?.tpIssuedAt ?? booking?.deliveryEta ?? booking?.bookedAt;
    if (!deliveredAt) continue;

    const jobs = data.job_cards.filter((j) => j.vin === unit.vin && j.status === "Closed").sort((a, b) => +new Date(b.closedAt ?? b.openedAt) - +new Date(a.closedAt ?? a.openedAt));
    const freeServicesDone = jobs.filter((j) => j.serviceType === "Free Service").length;
    const last = jobs.find((j) => j.serviceType === "Free Service" || j.serviceType === "Paid Service");
    out.push({
      unit,
      customer: booking?.customer ?? registration?.customer ?? "Unknown owner",
      phone: booking?.phone ?? null,
      dealer: booking?.dealer ?? registration?.dealer ?? unit.location,
      registrationNo: unit.registrationNo ?? registration?.registrationNo ?? null,
      deliveredAt,
      bookingId: booking?.id ?? null,
      next: nextService(deliveredAt, freeServicesDone, last ? { at: last.closedAt ?? last.openedAt, km: last.odometerKm } : undefined),
      freeServicesDone,
    });
  }
  return out;
}
