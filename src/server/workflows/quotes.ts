import "server-only";
import { rupees } from "@/lib/gst";
import { OPERATOR } from "@/lib/operator";
import { updateRow } from "../store";
import type { Quotation } from "../types";
import { sendMessage } from "./messaging";

/**
 * Marks a quotation sent and messages it to the customer — from Send, or when
 * a discount it was waiting on is approved. Server-only: not an action, so it
 * cannot be called from a browser with a made-up quotation.
 */
export async function shareWithCustomer(q: Quotation, payable: number): Promise<void> {
  const at = new Date().toISOString();
  await updateRow("quotations", q.id, { status: "Sent", history: [...q.history, { status: "Sent", at, by: OPERATOR.name, note: "Shared on WhatsApp" }] });
  await sendMessage({
    channel: "WhatsApp",
    template: "quotation_shared",
    to: q.phone,
    customer: q.customer,
    vars: [q.customer, q.quoteNo, rupees(payable), new Date(q.validUntil).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })],
    related: { kind: "quotation", id: q.id, label: q.quoteNo },
  });
}
