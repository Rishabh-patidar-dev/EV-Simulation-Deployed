"use server";

import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { ADJUSTMENT_REASONS, PART_CATEGORIES } from "@/lib/inventory";
import { PLANT } from "@/lib/stock";
import { VEHICLE_MODELS } from "@/lib/vehicles";
import { numericRef } from "../numbering";
import { runtimeId } from "../ids";
import { deleteRow, insertRow, readMany, updateRow } from "../store";
import { ORDER_VARIANTS, type SparePart } from "../types";
import { logMovement } from "../workflows/stock";
import { gone, int, isId, oneOf, refresh, str, type Prev } from "./input";
import { saving } from "./outcome";

/**
 * Stock writes that are not part of another flow: parts received against a
 * purchase, reorder levels and prices, and vehicle transfers between
 * locations. Each movement lands in the Inventory Logs.
 */


/** A part the workshop can issue — new to the catalogue, with its opening stock. */
export async function createSparePart(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const sku = str(fd, "sku", 24)
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "");
    if (sku.length < 3) return failed("Give the part an SKU", "Letters, numbers and dashes — e.g. SP-BAT-100.");
    const name = str(fd, "name", 80);
    if (!name) return failed("Name the part");
    const category = oneOf(fd, "category", PART_CATEGORIES);
    if (!category) return failed("Choose a category");
    const onHand = int(fd, "onHand", 0, 100_000);
    const reorderLevel = int(fd, "reorderLevel", 0, 10_000);
    const unitPrice = int(fd, "unitPrice", 1, 1_000_000);
    if (onHand === null || reorderLevel === null || unitPrice === null) return failed("Check the figures", "Opening stock 0–100,000, reorder level 0–10,000, price ₹1 or more.");
    const location = str(fd, "location", 60) || "Pune Plant";

    const { data } = await readMany(["spare_parts"] as const);
    if (data.spare_parts.some((p) => p.sku.toUpperCase() === sku)) return failed(`SKU ${sku} is already in the catalogue`);

    const part: SparePart = {
      id: runtimeId("PART"),
      sku,
      name,
      category,
      onHand,
      reorderLevel,
      unitPrice,
      location,
    };
    await insertRow("spare_parts", part);
    // Opening stock is a movement like any other, so the logs still add up.
    if (onHand > 0)
      await logMovement({
        entity: "Spare Part",
        reference: `${sku} · Opening stock`,
        direction: "IN",
        quantity: onHand,
        bucket: "Purchase Receipt",
      });
    refresh();
    return succeeded(`${name} added`, `${sku} · ${onHand} on hand at ${location}`);
  });
}

/** Only a part with no stock and no history — anything issued to a job card stays. */
export async function deleteSparePart(partId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(partId)) return gone("part");
    const { data } = await readMany(["spare_parts", "job_cards"] as const);
    const part = data.spare_parts.find((p) => p.id === partId);
    if (!part) return gone("part");
    if (part.onHand > 0) return failed(`${part.name} still has stock`, `${part.onHand} on hand — write it off before removing the part.`);
    if (data.job_cards.some((j) => j.parts.some((line) => line.partId === partId)))
      return failed("This part has been issued to a job card", "It stays so those job cards still price correctly.");
    await deleteRow("spare_parts", partId);
    refresh();
    return succeeded(`${part.name} removed`, part.sku);
  });
}

/**
 * A physical count or a write-off, taken on the part itself. The counted
 * figure replaces the book figure and the difference is written to the
 * Inventory Logs in the same action, so every change to on-hand stock arrives
 * in the ledger with a reason — the ledger screen itself never writes.
 */
export async function recordStockAdjustment(partId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(partId)) return gone("part");
    const counted = int(fd, "counted", 0, 100_000);
    if (counted === null) return failed("The counted quantity must be 0–100,000");
    const reason = oneOf(fd, "reason", ADJUSTMENT_REASONS);
    if (!reason) return failed("Choose a reason");
    const note = str(fd, "note", 40);

    const { data } = await readMany(["spare_parts"] as const);
    const part = data.spare_parts.find((p) => p.id === partId);
    if (!part) return gone("part");
    const delta = counted - part.onHand;
    if (delta === 0) return failed("That is the figure already on file", `${part.name} is at ${part.onHand}.`);

    // Only log the movement once the stock write has landed — a part deleted
    // between the read and the write must not leave a movement behind.
    if (!(await updateRow("spare_parts", partId, { onHand: counted }))) return gone("part");
    await logMovement({
      entity: "Spare Part",
      reference: note ? `${part.sku} · ${note}` : part.sku,
      direction: delta > 0 ? "IN" : "OUT",
      quantity: Math.abs(delta),
      bucket: reason,
    });
    refresh();
    return succeeded(`${part.name} set to ${counted}`, `${delta > 0 ? "+" : ""}${delta} · ${reason}`);
  });
}

export async function receiveParts(partId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(partId)) return gone("part");
    const quantity = int(fd, "quantity", 1, 10_000);
    if (quantity === null) return failed("Quantity must be 1–10,000");
    const reference = str(fd, "reference", 40) || "GRN";
    const { data } = await readMany(["spare_parts"] as const);
    const part = data.spare_parts.find((p) => p.id === partId);
    if (!part) return gone("part");
    await updateRow("spare_parts", part.id, { onHand: part.onHand + quantity });
    await logMovement({
      entity: "Spare Part",
      reference: `${part.sku} · ${reference}`,
      direction: "IN",
      quantity,
      bucket: "Purchase Receipt",
    });
    refresh();
    return succeeded(`${quantity} × ${part.name} received`, `${part.onHand + quantity} on hand now.`);
  });
}

/** The part's own details as well as its reorder level and price. */
export async function adjustPart(partId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(partId)) return gone("part");
    const reorderLevel = int(fd, "reorderLevel", 0, 10_000);
    const unitPrice = int(fd, "unitPrice", 1, 1_000_000);
    if (reorderLevel === null || unitPrice === null) return failed("Reorder level 0–10,000 and a price of ₹1 or more");

    // The form sends all five fields, so an empty one is a cleared field and
    // not an absent one: refuse it rather than saving a part with no name or
    // nowhere to be found.
    const name = str(fd, "name", 80);
    if (!name) return failed("Name the part");
    const category = oneOf(fd, "category", PART_CATEGORIES);
    if (!category) return failed("Choose a category");
    const location = str(fd, "location", 60);
    if (!location) return failed("Say where the part is kept");

    const updated = await updateRow("spare_parts", partId, {
      reorderLevel,
      unitPrice,
      name,
      category,
      location,
    });
    if (!updated) return gone("part");
    refresh();
    return succeeded(`${updated.name} updated`, `Reorder at ${reorderLevel}`);
  });
}

export async function transferVehicle(unitId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(unitId)) return gone("vehicle");
    const location = str(fd, "location", 80);
    if (location.length < 2) return failed("Choose where it is going");
    const { data } = await readMany(["vehicle_units"] as const);
    const unit = data.vehicle_units.find((u) => u.id === unitId);
    if (!unit) return gone("vehicle");
    if (unit.status !== "In Stock") return failed(`A vehicle that is ${unit.status.toLowerCase()} can't be transferred`);
    if (unit.location === location) return failed(`It is already at ${location}`);
    await updateRow("vehicle_units", unit.id, { location });
    await logMovement({
      entity: "Vehicle",
      reference: `${unit.vin} · ${unit.location} → ${location}`,
      direction: "OUT",
      quantity: 1,
      bucket: "Stock Transfer",
    });
    refresh();
    return succeeded(`${unit.vin} moved to ${location}`);
  });
}

/**
 * Vehicles off the production line into OEM stock at the plant — the stock
 * dealer orders are checked against and confirmed from.
 */
export async function receiveFromProduction(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const model = str(fd, "model", 60);
    if (!VEHICLE_MODELS.includes(model)) return failed("Choose a model from the list");
    const variant = oneOf(fd, "variant", ORDER_VARIANTS);
    if (!variant) return failed("Choose a variant");
    const quantity = int(fd, "quantity", 1, 500);
    if (quantity === null) return failed("Quantity is 1–500");
    const location = str(fd, "location", 80) || PLANT;
    const { data } = await readMany(["vehicle_units", "dealers", "products"] as const);
    if (data.dealers.some((d) => d.name === location)) return failed(`${location} is a dealership`, "Production goes into a plant or warehouse; dealers get stock through Order Management.");
    const exShowroom = data.products.find((p) => p.model === model)?.variants.find((v) => v.variant === variant)?.exShowroom;
    // The price list's ex-showroom price, or what this model is valued at in stock today.
    const same = data.vehicle_units.filter((u) => u.model === model);
    const price = exShowroom ?? (same.length ? Math.round(same.reduce((sum, u) => sum + u.price, 0) / same.length) : 0);
    if (!price) return failed(`No price on file for ${model} ${variant}`, "Add the variant to the price list first.");

    const taken = new Set(data.vehicle_units.map((u) => u.vin));
    const vins: string[] = [];
    for (let i = 0; i < quantity; i++) {
      let vin = "";
      do vin = `MA3LX${numericRef(2)}EV${numericRef(6)}`;
      while (taken.has(vin));
      taken.add(vin);
      vins.push(vin);
      await insertRow("vehicle_units", { id: runtimeId("VIN"), vin, model, variant, location, status: "In Stock", ageingDays: 0, price, bookingId: null, orderId: null });
    }
    await logMovement({ entity: "Vehicle", reference: `${model} ${variant} · ${vins[0]}${quantity > 1 ? ` … ${vins[vins.length - 1]}` : ""}`, direction: "IN", quantity, bucket: "Production" });
    refresh();
    return succeeded(`${quantity} × ${model} ${variant} into stock at ${location}`, "Short dealer orders can be re-checked now.");
  });
}
