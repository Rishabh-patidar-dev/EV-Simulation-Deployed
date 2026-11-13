"use server";

import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { OPERATOR } from "@/lib/operator";
import { RTO_STATE_CODES, registrationNumber } from "@/lib/rto";
import { numericRef } from "../numbering";
import { readMany, updateRow } from "../store";
import type { Registration, WorkflowEvent } from "../types";
import { sendMessage } from "../workflows/messaging";
import { gone, int, isId, refresh, str, ticked, type Prev } from "./input";
import { saving } from "./outcome";

/**
 * RTO & registration — one file per vehicle, from the temporary registration
 * issued at handover to the RC.
 *
 * TP Issued → every document in → Documents Ready → filed on Vahan →
 * Submitted → (Objection → answered → Submitted) → Approved with its
 * registration number, written back onto the vehicle → HSRP fitted → RC
 * Issued.
 */

const event = (status: string, note?: string): WorkflowEvent => ({ status, at: new Date().toISOString(), by: OPERATOR.name, ...(note ? { note } : {}) });

async function loadRegistration(regId: string) {
  if (!isId(regId)) return null;
  const { data } = await readMany(["registrations"] as const);
  return data.registrations.find((r) => r.id === regId) ?? null;
}

export async function updateRtoDocuments(regId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const r = await loadRegistration(regId);
    if (!r) return gone("registration");
    if (r.status !== "TP Issued" && r.status !== "Documents Ready" && r.status !== "Objection") return failed("The file is with the RTO — documents are locked");
    const ready = ticked(fd, "doc");
    const documents = r.documents.map((d) => ({ ...d, ready: ready.has(d.name) }));
    const complete = documents.every((d) => d.ready);
    const patch: Partial<Registration> = { documents };
    if (r.status === "TP Issued" && complete) {
      patch.status = "Documents Ready";
      patch.history = [...r.history, event("Documents Ready")];
    } else if (r.status === "Documents Ready" && !complete) {
      patch.status = "TP Issued";
    }
    await updateRow("registrations", r.id, patch);
    refresh();
    const missing = documents.filter((d) => !d.ready).length;
    return succeeded("Documents updated", missing ? `${missing} still to collect.` : "The file is complete — submit it on Vahan.");
  });
}

export async function submitToRto(regId: string): Promise<ActionResult> {
  return saving(async () => {
    const r = await loadRegistration(regId);
    if (!r) return gone("registration");
    if (r.status !== "Documents Ready") return failed(r.status === "TP Issued" ? "Collect every document first" : `Already ${r.status.toLowerCase()}`);
    const { data } = await readMany(["connectors"] as const);
    const vahan = data.connectors.find((c) => c.key === "vahan");
    if (!vahan || vahan.status !== "Connected") return failed("Vahan is not connected", "Reconnect it under API Integrations, or file at the RTO counter.");
    const vahanAppNo = `${RTO_STATE_CODES[r.state] ?? "XX"}${String(new Date().getFullYear()).slice(-2)}${numericRef(10)}`;
    await updateRow("registrations", r.id, { status: "Submitted", vahanAppNo, submittedAt: new Date().toISOString(), history: [...r.history, event("Submitted", `Vahan application ${vahanAppNo}`)] });
    refresh();
    return succeeded(`${r.appNo} filed on Vahan`, vahanAppNo);
  });
}

export async function raiseObjection(regId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const r = await loadRegistration(regId);
    if (!r) return gone("registration");
    if (r.status !== "Submitted") return failed("Only a filed application can draw an objection");
    const note = str(fd, "objection", 300);
    if (note.length < 3) return failed("Record what the RTO objected to");
    await updateRow("registrations", r.id, { status: "Objection", objection: note, history: [...r.history, event("Objection", note)] });
    refresh();
    return succeeded("Objection recorded", "Answer it and re-submit.");
  });
}

export async function resolveObjection(regId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const r = await loadRegistration(regId);
    if (!r) return gone("registration");
    if (r.status !== "Objection") return failed("There is no open objection");
    const note = str(fd, "note", 300);
    if (note.length < 3) return failed("Say how the objection was answered");
    await updateRow("registrations", r.id, { status: "Submitted", objection: null, history: [...r.history, event("Re-submitted", note)] });
    refresh();
    return succeeded("Re-submitted to the RTO", note);
  });
}

/** Approval brings the registration number — written onto the vehicle so every module shows it. */
export async function approveRegistration(regId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const r = await loadRegistration(regId);
    if (!r) return gone("registration");
    if (r.status !== "Submitted") return failed("Only a filed application can be approved");
    const series = str(fd, "series", 3).toUpperCase();
    if (!/^[A-Z]{1,3}$/.test(series)) return failed("The series is one to three letters", "e.g. EV");
    const number = int(fd, "number", 1, 9999);
    if (number === null) return failed("The number runs from 1 to 9999");

    const regNo = registrationNumber(r.rtoOffice, series, number);
    const { data } = await readMany(["registrations", "bookings"] as const);
    if (data.registrations.some((x) => x.registrationNo === regNo)) return failed(`${regNo} is already allotted`, "Check the number on the RTO's approval.");

    await updateRow("registrations", r.id, { status: "Approved", registrationNo: regNo, approvedAt: new Date().toISOString(), history: [...r.history, event("Approved", regNo)] });
    await updateRow("vehicle_units", r.vehicleUnitId, { registrationNo: regNo });

    const phone = data.bookings.find((b) => b.id === r.bookingId)?.phone;
    if (phone) {
      await sendMessage({
        channel: "WhatsApp",
        template: "rto_registered",
        to: phone,
        customer: r.customer,
        vars: [r.customer, r.model, regNo],
        related: { kind: "registration", id: r.id, label: r.appNo },
      });
    }
    refresh();
    return succeeded(`Registered as ${regNo}`, "Order the HSRP plates next.");
  });
}

export async function recordHsrp(regId: string): Promise<ActionResult> {
  return saving(async () => {
    const r = await loadRegistration(regId);
    if (!r) return gone("registration");
    if (r.status !== "Approved") return failed("Plates are fitted once the number is allotted");
    if (r.hsrpFittedAt) return failed("Already fitted");
    await updateRow("registrations", r.id, { hsrpFittedAt: new Date().toISOString(), history: [...r.history, event("HSRP fitted", `${r.registrationNo} — green plate, yellow characters`)] });
    refresh();
    return succeeded("HSRP fitted", r.registrationNo ?? undefined);
  });
}

export async function issueRc(regId: string): Promise<ActionResult> {
  return saving(async () => {
    const r = await loadRegistration(regId);
    if (!r) return gone("registration");
    if (r.status !== "Approved") return failed("The RC follows approval");
    if (!r.hsrpFittedAt) return failed("Fit the HSRP plates first");
    await updateRow("registrations", r.id, { status: "RC Issued", rcIssuedAt: new Date().toISOString(), history: [...r.history, event("RC Issued")] });
    refresh();
    return succeeded(`RC issued for ${r.registrationNo}`, "Registration is complete.");
  });
}
