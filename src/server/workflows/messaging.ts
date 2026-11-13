import "server-only";
import { runtimeId } from "../ids";
import { insertRow, readCollection } from "../store";
import type { Message } from "../types";

/**
 * Outbound customer messages — booking confirmations, delivery OTPs, service
 * reminders, ticket updates.
 *
 * Simulated: nothing leaves the app. A message is written to the log with the
 * status a real send would have had — sent when its channel is connected and
 * its template approved, failed (with the reason) when not — so switching a
 * connector off in API Integrations visibly stops messages going out.
 */
export async function sendMessage(input: {
  channel: Message["channel"];
  template: string;
  to: string;
  customer: string;
  /** Values for the template's placeholders, in order. */
  vars: string[];
  related: Message["related"];
}): Promise<Message> {
  const [{ rows: connectors }, { rows: templates }] = await Promise.all([readCollection("connectors"), readCollection("message_templates")]);
  const connector = connectors.find((c) => c.key === (input.channel === "WhatsApp" ? "whatsapp" : "sms"));
  const template = templates.find((t) => t.channel === input.channel && t.name === input.template);

  let error: string | null = null;
  if (!connector || connector.status !== "Connected") error = `${input.channel} is ${connector ? connector.status.toLowerCase() : "not set up"}`;
  else if (!template) error = `No ${input.channel} template called "${input.template}"`;
  else if (template.status !== "Approved") error = `Template "${template.name}" is ${template.status.toLowerCase()}`;

  let i = 0;
  const body = template ? template.body.replace(/\{\{\d+\}\}|\{#var#\}/g, () => input.vars[i++] ?? "") : input.vars.join(" · ");

  const message: Message = {
    id: runtimeId("MSG"),
    channel: input.channel,
    to: input.to,
    customer: input.customer,
    templateId: template?.id ?? null,
    template: input.template,
    body,
    status: error ? "Failed" : "Sent",
    error,
    related: input.related,
    at: new Date().toISOString(),
  };
  await insertRow("messages", message);
  return message;
}

/** A WhatsApp template the platform needs but did not start with — added pending, so it is approved before anything is sent. */
export async function ensureTemplate(name: string, body: string): Promise<void> {
  const { rows } = await readCollection("message_templates");
  if (rows.some((t) => t.channel === "WhatsApp" && t.name === name)) return;
  await insertRow("message_templates", {
    id: runtimeId("TPL"),
    channel: "WhatsApp",
    name,
    category: "Utility",
    senderId: null,
    dltTemplateId: null,
    body,
    status: "Pending",
    updatedAt: new Date().toISOString(),
  });
}

/** Who a dealer's messages go to: an active dealer-side login for that dealership with a phone. */
export async function dealerContact(dealer: string) {
  const { rows } = await readCollection("users");
  return rows.find((u) => u.dealer === dealer && u.status === "Active" && u.phone) ?? null;
}
