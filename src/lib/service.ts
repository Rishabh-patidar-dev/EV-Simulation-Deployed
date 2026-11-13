/**
 * The service schedule and workshop rates.
 *
 * Luxus Green does not publish its schedule, so this is the workshop policy
 * the simulation runs on: three free services in the first six months, then
 * a paid service every six months or 10,000 km, whichever comes first.
 */

import type { Money } from "@/server/types";

const DAY = 86_400_000;

export const FREE_SERVICES = [
  { no: 1, days: 30, km: 1_000 },
  { no: 2, days: 90, km: 5_000 },
  { no: 3, days: 180, km: 10_000 },
] as const;

const PAID_INTERVAL = { days: 180, km: 10_000 } as const;

/** Workshop labour, ₹ an hour before GST. */
export const LABOUR_RATE: Money = 450;

export interface ServiceDue {
  dueAt: string;
  dueKm: number;
  /** "Free service 2" or "Paid service". */
  label: string;
  freeServiceNo: number | null;
}

/**
 * The next service for a vehicle, from when it was delivered and the free
 * services it has already had, or from its last service once those are used.
 */
export function nextService(deliveredAt: string, freeServicesDone: number, last?: { at: string; km: number }): ServiceDue {
  const next = FREE_SERVICES[freeServicesDone];
  if (next) {
    return { dueAt: new Date(new Date(deliveredAt).getTime() + next.days * DAY).toISOString(), dueKm: next.km, label: `Free service ${next.no}`, freeServiceNo: next.no };
  }
  const from = last ?? { at: deliveredAt, km: FREE_SERVICES[FREE_SERVICES.length - 1].km };
  return {
    dueAt: new Date(new Date(from.at).getTime() + PAID_INTERVAL.days * DAY).toISOString(),
    dueKm: from.km + PAID_INTERVAL.km,
    label: "Paid service",
    freeServiceNo: null,
  };
}
