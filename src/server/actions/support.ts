"use server";

import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { vehiclesOnRoad } from "@/lib/fleet";
import { OPERATOR } from "@/lib/operator";
import { SLA, slaTargets } from "@/lib/sla";
import { runtimeId } from "../ids";
import { nextNumber } from "../numbering";
import { insertRow, readMany, updateRow } from "../store";
import { assignableStaff } from "../staff";
import { TICKET_CATEGORIES, TICKET_CHANNELS, TICKET_PRIORITIES, type SupportTicket, type TicketMessage } from "../types";
import { sendMessage } from "../workflows/messaging";
import { gone, int, isId, oneOf, phoneField, refresh, str, type Prev } from "./input";
import { saving } from "./outcome";

/**
 * Customer support — tickets from the phone line, WhatsApp, email and the
 * website's support form, on the site's own categories. Each carries an SLA
 * from its priority; escalation hands it to the Relationship Manager for the
 * customer's region; resolution asks for a CSAT score.
 */

/** Region of a state — how an escalation finds its Relationship Manager. */
const REGION_OF: Record<string, string> = {
  Punjab: "North", Haryana: "North", Delhi: "North", "Uttar Pradesh": "North", "Jammu and Kashmir": "North", Rajasthan: "North",
  Maharashtra: "West", Gujarat: "West", Goa: "West",
  "Tamil Nadu": "South", Karnataka: "South", Kerala: "South", Telangana: "South", "Andhra Pradesh": "South",
  Bihar: "East", Jharkhand: "East", "West Bengal": "East", Odisha: "East", Assam: "East",
  "Madhya Pradesh": "Central", Chhattisgarh: "Central",
};

const msg = (kind: TicketMessage["kind"], text: string, by: string = OPERATOR.name): TicketMessage => ({ at: new Date().toISOString(), by, kind, text });

async function loadTicket(ticketId: string) {
  if (!isId(ticketId)) return null;
  const { data } = await readMany(["tickets"] as const);
  return data.tickets.find((t) => t.id === ticketId) ?? null;
}

const closedStatus = (t: SupportTicket) => t.status === "Resolved" || t.status === "Closed";

export async function openTicket(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const { data } = await readMany(["tickets", "vehicle_units", "bookings", "deliveries", "registrations", "job_cards", "dealers"] as const);
    const customer = str(fd, "customer", 120);
    if (!customer) return failed("Enter the customer's name");
    const phone = phoneField(fd, "phone");
    if (!phone) return failed("Enter a valid 10-digit mobile number");
    const channel = oneOf(fd, "channel", TICKET_CHANNELS) ?? "Phone";
    const category = oneOf(fd, "category", TICKET_CATEGORIES);
    if (!category) return failed("Choose what the ticket is about");
    const priority = oneOf(fd, "priority", TICKET_PRIORITIES) ?? "P3";
    const subject = str(fd, "subject", 140);
    const description = str(fd, "description", 2000);
    if (!subject || !description) return failed("Give the ticket a subject and describe the problem");

    const vin = str(fd, "vin", 20).toUpperCase() || null;
    const onRoad = vin ? vehiclesOnRoad(data).find((v) => v.unit.vin === vin || v.registrationNo?.replace(/\s/g, "") === vin.replace(/\s/g, "")) : undefined;
    const dealerName = str(fd, "dealer") || onRoad?.dealer || null;
    const dealer = dealerName ? data.dealers.find((d) => d.name === dealerName) : undefined;

    const agents = await assignableStaff("support.manage");
    const assignee = oneOf(fd, "assignee", agents) ?? agents[0] ?? OPERATOR.name;
    const openedAt = new Date().toISOString();
    const ticket: SupportTicket = {
      id: runtimeId("TKT"),
      ticketNo: nextNumber(data.tickets.map((t) => t.ticketNo), "TKT", 5000),
      customer,
      phone,
      city: str(fd, "city", 60) || dealer?.city || "",
      channel,
      category,
      priority,
      subject,
      model: onRoad?.unit.model ?? null,
      vin: onRoad?.unit.vin ?? vin,
      dealer: dealer?.name ?? null,
      claimId: null,
      status: "Open",
      assignee,
      escalatedTo: null,
      openedAt,
      ...slaTargets(priority, openedAt),
      firstResponseAt: null,
      resolvedAt: null,
      resolution: null,
      csat: null,
      thread: [msg("Customer", description, customer), msg("System", `Logged via ${channel} · ${priority} (${SLA[priority].label}) · assigned to ${assignee}`, "System")],
    };
    await insertRow("tickets", ticket);
    await sendMessage({
      channel: "WhatsApp",
      template: "ticket_opened",
      to: phone,
      customer,
      vars: [customer, ticket.ticketNo, `${SLA[priority].respondHours} hour${SLA[priority].respondHours === 1 ? "" : "s"}`],
      related: { kind: "ticket", id: ticket.id, label: ticket.ticketNo },
    });
    refresh();
    return succeeded(`Ticket ${ticket.ticketNo} opened`, `${priority} · first response due within ${SLA[priority].respondHours}h · ${assignee}`);
  });
}

/** An agent's reply to the customer, or an internal note. */
export async function replyToTicket(ticketId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const t = await loadTicket(ticketId);
    if (!t) return gone("ticket");
    if (t.status === "Closed") return failed("The ticket is closed", "Reopen it to reply.");
    const text = str(fd, "text", 2000);
    if (!text) return failed("Write the reply first");
    const internal = fd.get("internal") === "on";
    const awaiting = fd.get("awaitCustomer") === "on";
    const now = new Date().toISOString();

    const patch: Partial<SupportTicket> = { thread: [...t.thread, msg(internal ? "Internal" : "Agent", text)] };
    if (!internal && !t.firstResponseAt) patch.firstResponseAt = now;
    if (!closedStatus(t) && t.status !== "Escalated") patch.status = awaiting && !internal ? "Awaiting Customer" : "In Progress";
    await updateRow("tickets", t.id, patch);
    if (!internal) {
      await sendMessage({
        channel: "WhatsApp",
        template: "ticket_update",
        to: t.phone,
        customer: t.customer,
        vars: [t.ticketNo, text.length > 300 ? `${text.slice(0, 297)}…` : text],
        related: { kind: "ticket", id: t.id, label: t.ticketNo },
      });
    }
    refresh();
    return succeeded(internal ? "Note added" : "Reply sent", internal ? undefined : "On WhatsApp to the customer.");
  });
}

/** Records what the customer came back with — a call, an email, a WhatsApp reply. */
export async function logCustomerReply(ticketId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const t = await loadTicket(ticketId);
    if (!t) return gone("ticket");
    const text = str(fd, "text", 2000);
    if (!text) return failed("Enter what the customer said");
    await updateRow("tickets", t.id, {
      thread: [...t.thread, msg("Customer", text, t.customer)],
      status: t.status === "Awaiting Customer" ? "In Progress" : t.status,
    });
    refresh();
    return succeeded("Customer's reply logged");
  });
}

export async function reassignTicket(ticketId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const t = await loadTicket(ticketId);
    if (!t) return gone("ticket");
    if (closedStatus(t)) return failed("Reopen the ticket to change it");
    const agents = await assignableStaff("support.manage");
    const assignee = oneOf(fd, "assignee", agents);
    const priority = oneOf(fd, "priority", TICKET_PRIORITIES);
    if (!assignee || !priority) return failed("Choose an agent and a priority");
    const changes: string[] = [];
    const patch: Partial<SupportTicket> = {};
    if (assignee !== t.assignee) {
      patch.assignee = assignee;
      changes.push(`assigned to ${assignee}`);
    }
    if (priority !== t.priority) {
      // The SLA is re-based on the new priority, from when the ticket was opened.
      Object.assign(patch, { priority, ...slaTargets(priority, t.openedAt) });
      changes.push(`priority ${t.priority} → ${priority}`);
    }
    if (!changes.length) return failed("Nothing changed");
    patch.thread = [...t.thread, msg("System", changes.join(" · "), OPERATOR.name)];
    await updateRow("tickets", t.id, patch);
    refresh();
    return succeeded("Ticket updated", changes.join(" · "));
  });
}

/** Hands the ticket to the Relationship Manager for the customer's region. */
export async function escalateTicket(ticketId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const t = await loadTicket(ticketId);
    if (!t) return gone("ticket");
    if (closedStatus(t) || t.status === "Escalated") return failed(t.status === "Escalated" ? `Already with ${t.escalatedTo}` : "Reopen the ticket to escalate it");
    const note = str(fd, "note", 500);
    if (note.length < 3) return failed("Say why it is escalated");
    const { data } = await readMany(["users", "dealers"] as const);
    const state = data.dealers.find((d) => d.name === t.dealer)?.state;
    const region = state ? REGION_OF[state] : undefined;
    const rms = data.users.filter((u) => u.role === "Relationship Manager" && u.status === "Active");
    const rm = rms.find((u) => u.region === region) ?? rms[0];
    const to = rm?.name ?? "Relationship Manager";
    await updateRow("tickets", t.id, {
      status: "Escalated",
      escalatedTo: to,
      thread: [...t.thread, msg("Internal", `Escalated to ${to}${region ? ` (${region})` : ""}: ${note}`)],
    });
    refresh();
    return succeeded(`Escalated to ${to}`, region ? `${region} region` : undefined);
  });
}

export async function linkClaimToTicket(ticketId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const t = await loadTicket(ticketId);
    if (!t) return gone("ticket");
    const claimNo = str(fd, "claimNo", 30).toUpperCase();
    const { data } = await readMany(["warranty_claims"] as const);
    const claim = data.warranty_claims.find((c) => c.claimNo.toUpperCase() === claimNo);
    if (!claim) return failed(`No warranty claim ${claimNo}`);
    await updateRow("tickets", t.id, { claimId: claim.id, thread: [...t.thread, msg("System", `Linked to warranty claim ${claim.claimNo} (${claim.status})`)] });
    refresh();
    return succeeded(`Linked to ${claim.claimNo}`);
  });
}

export async function resolveTicket(ticketId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const t = await loadTicket(ticketId);
    if (!t) return gone("ticket");
    if (closedStatus(t)) return failed(`Already ${t.status.toLowerCase()}`);
    const resolution = str(fd, "resolution", 1000);
    if (resolution.length < 5) return failed("Describe how it was resolved");
    const now = new Date().toISOString();
    await updateRow("tickets", t.id, {
      status: "Resolved",
      resolvedAt: now,
      resolution,
      firstResponseAt: t.firstResponseAt ?? now,
      thread: [...t.thread, msg("Agent", `Resolved: ${resolution}`)],
    });
    await sendMessage({
      channel: "WhatsApp",
      template: "ticket_resolved",
      to: t.phone,
      customer: t.customer,
      vars: [t.customer, t.ticketNo],
      related: { kind: "ticket", id: t.id, label: t.ticketNo },
    });
    refresh();
    return succeeded(`${t.ticketNo} resolved`, "The customer has been asked to rate the support.");
  });
}

export async function recordCsat(ticketId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const t = await loadTicket(ticketId);
    if (!t) return gone("ticket");
    if (t.status !== "Resolved") return failed("CSAT is recorded once the ticket is resolved");
    const csat = int(fd, "csat", 1, 5);
    if (csat === null) return failed("Rate 1 to 5");
    await updateRow("tickets", t.id, { csat, status: "Closed", thread: [...t.thread, msg("System", `Customer rated the support ${csat}/5 — closed`, t.customer)] });
    refresh();
    return succeeded(`Closed with CSAT ${csat}/5`);
  });
}

export async function reopenTicket(ticketId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const t = await loadTicket(ticketId);
    if (!t) return gone("ticket");
    if (!closedStatus(t)) return failed("The ticket is still open");
    const reason = str(fd, "reason", 300);
    if (reason.length < 3) return failed("Say why it is reopened");
    await updateRow("tickets", t.id, { status: "In Progress", resolvedAt: null, csat: null, thread: [...t.thread, msg("Customer", `Reopened: ${reason}`, t.customer)] });
    refresh();
    return succeeded(`${t.ticketNo} reopened`);
  });
}
