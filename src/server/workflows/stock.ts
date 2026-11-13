import "server-only";
import { OPERATOR } from "@/lib/operator";
import { runtimeId } from "../ids";
import { insertRow } from "../store";
import type { InventoryLog } from "../types";

/** Writes one stock movement to the Inventory Logs — every module that moves stock goes through here. */
export async function logMovement(input: Pick<InventoryLog, "entity" | "reference" | "direction" | "quantity" | "bucket">): Promise<void> {
  await insertRow("inventory_logs", {
    id: runtimeId("ILOG"),
    at: new Date().toISOString(),
    actor: OPERATOR.name,
    ...input,
  });
}
