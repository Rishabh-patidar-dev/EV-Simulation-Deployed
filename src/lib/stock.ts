import type { Dealer, Order, VehicleUnit } from "@/server/types";

/**
 * Manufacturer stock and the order desk's stock check — EV-CRM's Order
 * Management "Check Inventory / Close Orders" rules:
 *
 *  - OEM stock is a vehicle in stock somewhere that is not a dealership — a
 *    plant or a warehouse. (The CRM marks it with no dealer; here a unit's
 *    location is free text, so "not a dealer's name" is the same test.)
 *  - A dealer order is confirmed only when OEM stock covers every line.
 *    Confirming reserves those vehicles to the order, so two orders can never
 *    be promised the same unit.
 *  - An order stock cannot cover is short. It waits on the short list with an
 *    out-of-stock notice, and is re-checked when stock arrives. Orders
 *    competing for the same model and variant are ranked "best fit": the
 *    smallest shortfall against live stock first, then the larger order.
 */

/** Where finished vehicles come off the line. */
export const PLANT = "Bilaspur Plant";

export const isOemStock = (unit: Pick<VehicleUnit, "status" | "location" | "orderId">, dealerNames: ReadonlySet<string>) =>
  unit.status === "In Stock" && !dealerNames.has(unit.location);

/** Vehicles reserved to a dealer order, waiting to ship. */
export const reservedTo = (units: VehicleUnit[], orderId: string) => units.filter((u) => u.orderId === orderId && u.status === "Allocated");

export const lineKey = (l: { model: string; variant: string }) => `${l.model}|${l.variant}`;

/** OEM stock free to promise, by model and variant. */
export function freeOemStock(units: VehicleUnit[], dealers: Pick<Dealer, "name">[]): Map<string, VehicleUnit[]> {
  const names = new Set(dealers.map((d) => d.name));
  const out = new Map<string, VehicleUnit[]>();
  for (const u of units) {
    if (!isOemStock(u, names)) continue;
    const key = lineKey(u);
    out.set(key, [...(out.get(key) ?? []), u]);
  }
  // Oldest first, so ageing stock ships before fresh.
  for (const list of out.values()) list.sort((a, b) => b.ageingDays - a.ageingDays);
  return out;
}

export interface LineCheck {
  model: string;
  variant: string;
  requested: number;
  available: number;
}

/** Each line of an order against free OEM stock. */
export function checkLines(order: Pick<Order, "lines">, stock: Map<string, VehicleUnit[]>): LineCheck[] {
  return (order.lines ?? []).map((l) => ({ model: l.model, variant: l.variant, requested: l.quantity, available: stock.get(lineKey(l))?.length ?? 0 }));
}

export const coversAll = (checks: LineCheck[]) => checks.length > 0 && checks.every((c) => c.available >= c.requested);
export const shortfall = (checks: LineCheck[]) => checks.reduce((s, c) => s + Math.max(0, c.requested - c.available), 0);

/** Best-fit order for short orders competing for the same stock: least short first, then the larger order. */
export function bestFit<T extends { checks: LineCheck[]; order: Pick<Order, "units"> }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => shortfall(a.checks) - shortfall(b.checks) || b.order.units - a.order.units);
}

/** The order desk's numbers, as EV-CRM's order analytics computes them. Reads the clock here, not in a component body. */
export function orderDeskStats(orders: Order[], dealers: Pick<Dealer, "name" | "state">[], now = Date.now()) {
  const DAY = 86_400_000;
  const stateOf = new Map(dealers.map((d) => [d.name, d.state]));
  const open = orders.filter((o) => o.status !== "Received" && o.status !== "Cancelled");
  const resolved = orders.filter((o) => o.status === "Received" || o.status === "Cancelled");
  const avgOpenDays = open.length ? Math.round((open.reduce((s, o) => s + (now - new Date(o.placedAt).getTime()) / DAY, 0) / open.length) * 10) / 10 : 0;
  const fulfilment = resolved.length ? Math.round((resolved.filter((o) => o.status === "Received").length / resolved.length) * 100) : null;

  const byZone = new Map<string, number>();
  const topModel = new Map<string, Map<string, number>>();
  for (const o of orders) {
    if (o.status === "Cancelled") continue;
    const zone = stateOf.get(o.dealer) ?? "Unknown";
    byZone.set(zone, (byZone.get(zone) ?? 0) + o.units);
    const models = topModel.get(zone) ?? new Map<string, number>();
    for (const l of o.lines ?? []) models.set(l.model, (models.get(l.model) ?? 0) + l.quantity);
    topModel.set(zone, models);
  }
  const zones = [...byZone.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([zone, units]) => {
      const top = [...(topModel.get(zone) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0];
      return { zone, units, topModel: top ? `${top[0]} (${top[1]})` : "—" };
    });

  // Orders placed per week, last eight weeks, oldest first.
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const start = now - (8 - i) * 7 * DAY;
    const end = start + 7 * DAY;
    const label = new Date(start).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    return { label, value: orders.filter((o) => +new Date(o.placedAt) >= start && +new Date(o.placedAt) < end).length };
  });

  const oldest = [...open].sort((a, b) => +new Date(a.placedAt) - +new Date(b.placedAt)).slice(0, 5).map((o) => ({ order: o, days: Math.floor((now - new Date(o.placedAt).getTime()) / DAY) }));
  return { avgOpenDays, fulfilment, zones, weekly, oldest };
}
