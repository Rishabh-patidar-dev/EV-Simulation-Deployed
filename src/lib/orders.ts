import type { Order } from "@/server/types";

/** GST on electric vehicles — added on the invoice raised at dispatch. */
export const GST_RATE = 0.05;

/**
 * Past its expected date and still not with the dealer. Reads the clock here,
 * not in a component body, where React's purity rule rejects it.
 */
export function isLate(order: Pick<Order, "status" | "expectedBy">): boolean {
  return order.status !== "Received" && order.status !== "Cancelled" && new Date(order.expectedBy).getTime() < Date.now();
}
