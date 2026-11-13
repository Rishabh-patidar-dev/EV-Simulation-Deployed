"use server";

import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { CONNECTOR_CATALOGUE } from "@/lib/connectors";
import { rupees } from "@/lib/gst";
import { balance } from "@/lib/receivables";
import { runtimeId } from "../ids";
import { alphaRef } from "../numbering";
import { deleteRow, insertRow, readMany, updateRow, upsertRows } from "../store";
import type { Connector, Message, MessageTemplate, Payment, TelematicsDevice } from "../types";
import { replay } from "../workflows/ledger";
import { applyReceipt } from "../workflows/receivables";
import { gone, int, isId, oneOf, refresh, str, type Prev } from "./input";
import { saving } from "./outcome";

/**
 * API integrations — the connectors, and the simulated traffic across them.
 *
 * Nothing here calls an outside service: switching a connector off makes the
 * flows that depend on it fail the way they would (messages bounce, e-way
 * bills can't be raised, Vahan filings stop, vouchers queue), and the
 * "webhook" actions stand in for what a provider would call back with.
 */

const DAY = 86_400_000;

export async function setConnectorStatus(connectorId: string, statusArg: unknown): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(connectorId)) return gone("connector");
    const status = statusArg === "Connected" || statusArg === "Disconnected" ? statusArg : null;
    if (!status) return failed("Connect or disconnect");
    const { data } = await readMany(["connectors", "sync_queue"] as const);
    const connector = data.connectors.find((c) => c.id === connectorId);
    if (!connector) return gone("connector");
    if (status === "Connected" && !connector.credentialsSet) return failed(`${connector.name} has no credentials`, "Add them in the deployment's secret store first.");
    await updateRow("connectors", connector.id, { status, lastError: null, lastEventAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    let detail = status === "Connected" ? "Live again." : "Everything that depends on it now fails, as it would.";
    // Reconnecting the finance system drains whatever queued while it was down.
    if (status === "Connected" && connector.key === "accounting") {
      const queued = data.sync_queue.filter((q) => q.status === "Queued");
      if (queued.length) {
        const r = await replay(queued);
        detail = `${r.synced} queued voucher${r.synced === 1 ? "" : "s"} posted${r.failed ? `, ${r.failed} failed` : ""}.`;
      }
    }
    refresh();
    return succeeded(`${connector.name} ${status.toLowerCase()}`, detail);
  });
}

/**
 * Add a connector the platform knows about but has no row for yet.
 *
 * The catalogue in `lib/connectors.ts` is the source of truth for which
 * outside systems exist, so a new one can be set up from the screen instead of
 * needing a row seeded into the database first. It starts disconnected and
 * without credentials — connecting it is still a separate, deliberate act.
 */
export async function addConnector(keyArg: unknown): Promise<ActionResult> {
  return saving(async () => {
    const profile = CONNECTOR_CATALOGUE.find((c) => c.key === keyArg);
    if (!profile) return failed("That connector is not one this platform knows about");
    const { data } = await readMany(["connectors"] as const);
    if (data.connectors.some((c) => c.key === profile.key)) return failed(`${profile.name} is already set up`);
    const now = new Date().toISOString();
    const connector: Connector = {
      id: runtimeId("CONN"),
      key: profile.key,
      name: profile.name,
      provider: profile.provider,
      category: profile.category,
      status: "Disconnected",
      environment: "Sandbox",
      config: { ...profile.config },
      credentialsSet: false,
      lastEventAt: null,
      lastError: null,
      updatedAt: now,
    };
    await insertRow("connectors", connector);
    refresh();
    return succeeded(`${profile.name} added`, "Add its credentials to the secret store, then connect it.");
  });
}

export async function updateConnectorConfig(connectorId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(connectorId)) return gone("connector");
    const { data } = await readMany(["connectors"] as const);
    const connector = data.connectors.find((c) => c.id === connectorId);
    if (!connector) return gone("connector");
    const config: Record<string, string> = {};
    for (const key of Object.keys(connector.config)) config[key] = str(fd, `config.${key}`, 120) || connector.config[key];
    if (connector.key === "sms" && config.senderId && !/^[A-Z]{6}$/.test(config.senderId)) return failed("An SMS header is six capital letters", "It must match the header registered on DLT.");
    const environment = oneOf(fd, "environment", ["Sandbox", "Production"] as const) ?? connector.environment;
    await updateRow("connectors", connector.id, { config, environment, updatedAt: new Date().toISOString() });
    refresh();
    return succeeded(`${connector.name} settings saved`, environment);
  });
}

/** Stands in for the provider's delivery-report webhook: sent → delivered → read. */
export async function refreshDeliveryReports(): Promise<ActionResult> {
  return saving(async () => {
    const { data } = await readMany(["messages"] as const);
    let delivered = 0;
    let read = 0;
    // The whole log moves on in one write — a report per message would be a
    // round trip each, and the log only ever grows.
    const moved: Message[] = [];
    for (const m of data.messages) {
      if (m.status === "Sent") {
        moved.push({ ...m, status: "Delivered" });
        delivered++;
      } else if (m.status === "Delivered" && m.channel === "WhatsApp" && Math.random() < 0.6) {
        moved.push({ ...m, status: "Read" });
        read++;
      }
    }
    await upsertRows("messages", moved);
    refresh();
    return succeeded("Delivery reports in", `${delivered} delivered · ${read} read`);
  });
}

export async function retryMessage(messageId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(messageId)) return gone("message");
    const { data } = await readMany(["messages", "connectors", "message_templates"] as const);
    const m = data.messages.find((x) => x.id === messageId);
    if (!m) return gone("message");
    if (m.status !== "Failed") return failed("Only a failed message is retried");
    const connector = data.connectors.find((c) => c.key === (m.channel === "WhatsApp" ? "whatsapp" : "sms"));
    if (connector?.status !== "Connected") return failed(`${m.channel} is still ${connector?.status.toLowerCase() ?? "not set up"}`);
    const template = data.message_templates.find((t) => t.channel === m.channel && t.name === m.template);
    if (template && template.status !== "Approved") return failed(`Template "${template.name}" is ${template.status.toLowerCase()}`);
    await updateRow("messages", m.id, { status: "Sent", error: null, at: new Date().toISOString() });
    refresh();
    return succeeded(`Resent to ${m.customer}`);
  });
}

// ---------------------------------------------------------------------------
// Templates — WhatsApp templates and the SMS DLT registry.
// ---------------------------------------------------------------------------

const CATEGORIES = ["Utility", "Marketing", "Authentication", "Transactional", "Service Implicit", "Promotional"] as const;

export async function saveTemplate(templateId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(templateId)) return gone("template");
    const body = str(fd, "body", 1000);
    if (body.length < 5) return failed("The template needs a body");
    const status = oneOf(fd, "status", ["Approved", "Pending", "Rejected"] as const) ?? "Pending";
    const dltTemplateId = str(fd, "dltTemplateId", 19);
    if (dltTemplateId && !/^\d{19}$/.test(dltTemplateId)) return failed("A DLT template ID is 19 digits");
    const updated = await updateRow("message_templates", templateId, { body, status, dltTemplateId: dltTemplateId || null, updatedAt: new Date().toISOString() });
    if (!updated) return gone("template");
    refresh();
    return succeeded(`Template "${updated.name}" saved`, status);
  });
}

/** A template nothing has been sent on. One with traffic stays, so the log still reads. */
export async function deleteTemplate(templateId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(templateId)) return gone("template");
    const { data } = await readMany(["message_templates", "messages"] as const);
    const template = data.message_templates.find((t) => t.id === templateId);
    if (!template) return gone("template");
    const sent = data.messages.filter((m) => m.templateId === templateId).length;
    if (sent) return failed(`${template.name} has been used`, `${sent} message${sent === 1 ? "" : "s"} went out on it.`);
    await deleteRow("message_templates", templateId);
    refresh();
    return succeeded(`Template ${template.name} deleted`);
  });
}

export async function createTemplate(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const channel = oneOf(fd, "channel", ["WhatsApp", "SMS"] as const);
    if (!channel) return failed("Choose the channel");
    const name = str(fd, "name", 60).toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (name.length < 3) return failed("Name it in lower case — e.g. festive_offer");
    const category = oneOf(fd, "category", CATEGORIES);
    if (!category) return failed("Choose the category");
    const body = str(fd, "body", 1000);
    if (body.length < 5) return failed("Write the message");
    const { data } = await readMany(["message_templates", "connectors"] as const);
    if (data.message_templates.some((t) => t.channel === channel && t.name === name)) return failed(`There is already a ${channel} template called ${name}`);
    const template: MessageTemplate = {
      id: runtimeId("TPL"),
      channel,
      name,
      category,
      senderId: channel === "SMS" ? (data.connectors.find((c) => c.key === "sms")?.config.senderId ?? null) : null,
      dltTemplateId: null,
      body,
      // New templates wait for Meta's review (WhatsApp) or the DLT operator's (SMS).
      status: "Pending",
      updatedAt: new Date().toISOString(),
    };
    await insertRow("message_templates", template);
    refresh();
    return succeeded(`Template ${name} submitted`, "Pending approval — it can't be sent until approved.");
  });
}

// ---------------------------------------------------------------------------
// Payments — the gateway's view of token payments and dealer collections.
// ---------------------------------------------------------------------------

async function loadPayment(paymentId: string) {
  if (!isId(paymentId)) return null;
  const { data } = await readMany(["payments"] as const);
  return data.payments.find((p) => p.id === paymentId) ?? null;
}

/** Stands in for the gateway's payment.captured webhook. */
export async function capturePayment(paymentId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const p = await loadPayment(paymentId);
    if (!p) return gone("payment");
    if (p.status !== "Created") return failed(`Already ${p.status.toLowerCase()}`);
    const { data } = await readMany(["connectors", "invoices", "dealers"] as const);
    if (data.connectors.find((c) => c.key === "payments")?.status !== "Connected") return failed("The payment gateway is not connected");
    const method = oneOf(fd, "method", ["UPI", "Card", "Net Banking"] as const) ?? p.method;
    // UPI carries no MDR; cards and net banking 2%.
    const fee = method === "UPI" ? 0 : Math.round(p.amount * 0.02);
    const now = new Date();
    await updateRow("payments", p.id, { status: "Captured", method, fee, capturedAt: now.toISOString(), settledAt: new Date(now.getTime() + 2 * DAY).toISOString() });

    let detail = `${rupees(p.amount - fee)} settles T+2.`;
    if (p.purpose === "Dealer Invoice" && p.related?.kind === "invoice") {
      const invoice = data.invoices.find((i) => i.id === p.related?.id);
      if (invoice) {
        // Same path as a receipt typed in on Billing & Invoices: the invoice, the dealer's outstanding and the books.
        await applyReceipt(invoice, data.dealers.find((d) => d.name === invoice.dealer), { amount: Math.min(p.amount, balance(invoice)), mode: "Payment Gateway", reference: p.gatewayRef });
        detail += ` Applied to ${invoice.invoiceNo}.`;
      }
    }
    refresh();
    return succeeded(`${rupees(p.amount)} captured`, detail);
  });
}

export async function failPayment(paymentId: string): Promise<ActionResult> {
  return saving(async () => {
    const p = await loadPayment(paymentId);
    if (!p) return gone("payment");
    if (p.status !== "Created") return failed(`Already ${p.status.toLowerCase()}`);
    await updateRow("payments", p.id, { status: "Failed" });
    refresh();
    return succeeded("Marked failed", "The customer can pay again from a new link.");
  });
}

export async function refundPayment(paymentId: string): Promise<ActionResult> {
  return saving(async () => {
    const p = await loadPayment(paymentId);
    if (!p) return gone("payment");
    if (p.status !== "Captured") return failed("Only a captured payment is refunded");
    await updateRow("payments", p.id, { status: "Refunded" });
    refresh();
    return succeeded(`${rupees(p.amount)} refunded`, p.payer);
  });
}

/** A payment link for a dealer invoice — the dealer pays it through the gateway. */
export async function createInvoicePaymentLink(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const { data } = await readMany(["invoices", "payments"] as const);
    const invoice = data.invoices.find((i) => i.id === str(fd, "invoiceId", 64));
    if (!invoice) return failed("Choose an invoice");
    const due = invoice.amount - invoice.received;
    if (due <= 0) return failed(`${invoice.invoiceNo} is already paid`);
    if (data.payments.some((p) => p.related?.id === invoice.id && p.status === "Created")) return failed("A link is already out for this invoice");
    const amount = int(fd, "amount", 1, due) ?? due;
    const payment: Payment = {
      id: runtimeId("PAY"),
      gatewayRef: `plink_${alphaRef(14)}`,
      purpose: "Dealer Invoice",
      payer: invoice.dealer,
      amount,
      method: "Net Banking",
      status: "Created",
      fee: 0,
      related: { kind: "invoice", id: invoice.id, label: invoice.invoiceNo },
      createdAt: new Date().toISOString(),
      capturedAt: null,
      settledAt: null,
    };
    await insertRow("payments", payment);
    refresh();
    return succeeded(`Payment link for ${rupees(amount)}`, `${invoice.invoiceNo} · ${invoice.dealer}`);
  });
}

// ---------------------------------------------------------------------------
// Telematics — the IoT feed from vehicles on the road.
// ---------------------------------------------------------------------------

/** Pulls the latest reading from every device: distance run since the last ping, charge, battery health, alerts. */
export async function refreshTelematics(): Promise<ActionResult> {
  return saving(async () => {
    const { data } = await readMany(["telematics", "connectors"] as const);
    if (data.connectors.find((c) => c.key === "telematics")?.status !== "Connected") return failed("The telematics feed is not connected");
    const now = Date.now();
    let alerts = 0;
    // Every device is written back in one call: a pull over a fleet of
    // hundreds would otherwise take a round trip each and time the user out.
    const pulled: TelematicsDevice[] = [];
    for (const d of data.telematics) {
      // A few devices drop off the network between pulls; offline ones come back.
      if (Math.random() < 0.05) {
        pulled.push({ ...d, status: "Offline", alerts: [...new Set([...d.alerts.filter((a) => a !== "Offline"), "Offline"])] });
        alerts++;
        continue;
      }
      const days = Math.max(0.1, (now - new Date(d.lastSeenAt).getTime()) / DAY);
      const km = Math.round(days * (70 + Math.random() * 60));
      const soc = Math.max(5, Math.min(100, Math.round(Math.random() < 0.5 ? 100 - Math.random() * 40 : d.soc - Math.random() * 60)));
      const soh = Math.max(70, Math.round((d.soh - days * 0.004) * 10) / 10);
      const next: string[] = [];
      if (soc < 20) next.push("Low charge");
      if (soh < 85) next.push("Battery health below 85%");
      if (Math.random() < 0.03) next.push("Motor over-temperature");
      alerts += next.length;
      pulled.push({ ...d, soc, soh, odometerKm: d.odometerKm + km, lastSeenAt: new Date(now).toISOString(), status: "Online", alerts: next });
    }
    await upsertRows("telematics", pulled);
    const connector = data.connectors.find((c) => c.key === "telematics") as Connector;
    await updateRow("connectors", connector.id, { lastEventAt: new Date(now).toISOString() });
    refresh();
    return succeeded(`${data.telematics.length} devices refreshed`, alerts ? `${alerts} alert${alerts === 1 ? "" : "s"} raised` : "No alerts");
  });
}
