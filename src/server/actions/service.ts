"use server";

import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { vehiclesOnRoad } from "@/lib/fleet";
import { GST_RATE_STANDARD, HSN, rupees } from "@/lib/gst";
import { OPERATOR } from "@/lib/operator";
import { FREE_SERVICES, LABOUR_RATE, nextService } from "@/lib/service";
import { runtimeId } from "../ids";
import { nextNumber } from "../numbering";
import { insertRow, readMany, updateRow } from "../store";
import { JOB_BILL_TO, JOB_TYPES, type JobCard, type JobComplaint, type QuoteLine, type SparePart, type WarrantyClaim, type WorkflowEvent } from "../types";
import { issueTaxInvoice } from "../workflows/invoicing";
import { sendMessage } from "../workflows/messaging";
import { logMovement } from "../workflows/stock";
import { assignableStaff } from "../staff";
import { dateField, gone, int, isId, num, oneOf, phoneField, refresh, str, type Prev } from "./input";
import { saving } from "./outcome";
import { fileClaim } from "../workflows/warranty";

/**
 * Service job cards — vehicle in to invoice out.
 *
 * A card records each complaint with its cause and correction, the
 * technician's time, and parts issued straight off spare-parts stock (the
 * movement lands in the Inventory Logs). Every line is billed to the
 * customer, to a free service, or to warranty; closing the card invoices the
 * customer's share at 18% GST and raises a warranty claim for the rest.
 */

const DAY = 86_400_000;
const MAX_COMPLAINTS = 6;
const event = (status: string, note?: string): WorkflowEvent => ({ status, at: new Date().toISOString(), by: OPERATOR.name, ...(note ? { note } : {}) });

const PART_HSN: Record<SparePart["category"], string> = {
  Battery: HSN.lithiumBattery,
  Motor: HSN.motor,
  Controller: HSN.controller,
  Body: HSN.bodyPart,
  Electrical: HSN.electrical,
  Consumable: HSN.consumable,
};

/** The warranty component a failed part is claimed under. */
function claimComponent(parts: JobCard["parts"], catalogue: SparePart[]): WarrantyClaim["component"] {
  for (const p of parts) {
    const part = catalogue.find((x) => x.id === p.partId);
    if (/charger/i.test(p.name)) return "Charger";
    if (part?.category === "Battery") return "Battery Pack";
    if (part?.category === "Motor") return "Motor";
    if (part?.category === "Controller") return "Controller";
  }
  return "Harness";
}

async function loadJob(jobId: string) {
  if (!isId(jobId)) return null;
  const { data } = await readMany(["job_cards"] as const);
  return data.job_cards.find((j) => j.id === jobId) ?? null;
}

const editable = (j: JobCard) => j.status === "Open" || j.status === "In Progress" || j.status === "Awaiting Parts";

export async function openJobCard(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const { data } = await readMany(["vehicle_units", "bookings", "deliveries", "registrations", "job_cards", "dealers"] as const);
    const vin = str(fd, "vin", 20).toUpperCase();
    if (!/^[A-Z0-9]{11,17}$/.test(vin)) return failed("Enter the chassis number (VIN)");
    const onRoad = vehiclesOnRoad(data).find((v) => v.unit.vin === vin);
    const unit = data.vehicle_units.find((u) => u.vin === vin);

    const dealer = data.dealers.find((d) => d.name === str(fd, "dealer")) ?? data.dealers.find((d) => d.name === onRoad?.dealer);
    if (!dealer) return failed("Choose the workshop's dealer");
    const customer = str(fd, "customer", 120) || onRoad?.customer || "";
    if (!customer) return failed("Enter the customer's name");
    const phone = phoneField(fd, "phone") ?? onRoad?.phone ?? "";
    const odometerKm = int(fd, "odometerKm", 0, 500_000);
    if (odometerKm === null) return failed("Enter the odometer reading in km");
    const serviceType = oneOf(fd, "serviceType", JOB_TYPES);
    if (!serviceType) return failed("Choose the kind of job");

    const complaints: JobComplaint[] = fd
      .getAll("complaint")
      .map((c) => String(c).trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, MAX_COMPLAINTS)
      .map((complaint) => ({ complaint, cause: "", correction: "" }));
    if (!complaints.length) return failed("Record at least one complaint, in the customer's words");

    let freeServiceNo: number | null = null;
    if (serviceType === "Free Service") {
      const used = onRoad?.freeServicesDone ?? data.job_cards.filter((j) => j.vin === vin && j.serviceType === "Free Service" && j.status === "Closed").length;
      if (used >= FREE_SERVICES.length) return failed("Every free service is used", `This vehicle has had all ${FREE_SERVICES.length} — open it as a paid service.`);
      freeServiceNo = used + 1;
    }

    const technicians = await assignableStaff("service.manage");
    const technician = oneOf(fd, "technician", technicians) ?? technicians[0] ?? OPERATOR.name;
    const promisedAt = dateField(fd, "promisedAt") ?? new Date(Date.now() + DAY).toISOString();

    const job: JobCard = {
      id: runtimeId("JC"),
      jobNo: nextNumber(data.job_cards.map((j) => j.jobNo), "JC", 4000),
      dealer: dealer.name,
      customer,
      phone,
      vin,
      model: unit?.model || str(fd, "model", 60) || "Unknown",
      registrationNo: onRoad?.registrationNo ?? null,
      odometerKm,
      serviceType,
      freeServiceNo,
      complaints,
      technician,
      labour: [],
      parts: [],
      status: "Open",
      openedAt: new Date().toISOString(),
      promisedAt,
      closedAt: null,
      warrantyClaimId: null,
      taxInvoiceId: null,
      nextServiceAt: null,
      nextServiceKm: null,
      history: [event("Open", `${serviceType}${freeServiceNo ? ` #${freeServiceNo}` : ""} · ${odometerKm} km · ${technician}`)],
    };
    await insertRow("job_cards", job);
    refresh();
    return succeeded(`Job card ${job.jobNo} opened`, `${job.model} ${vin} for ${customer}.`);
  });
}

/** Cause and correction for each complaint, and any complaint found in the workshop. */
export async function updateDiagnosis(jobId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const j = await loadJob(jobId);
    if (!j) return gone("job card");
    if (!editable(j)) return failed(`A ${j.status.toLowerCase()} job card is locked`);
    const causes = fd.getAll("cause").map((v) => String(v).trim().slice(0, 300));
    const corrections = fd.getAll("correction").map((v) => String(v).trim().slice(0, 300));
    const complaints = j.complaints.map((c, i) => ({ ...c, cause: causes[i] ?? c.cause, correction: corrections[i] ?? c.correction }));
    const added = str(fd, "newComplaint", 200);
    if (added) {
      if (complaints.length >= MAX_COMPLAINTS) return failed(`At most ${MAX_COMPLAINTS} complaints on one card`);
      complaints.push({ complaint: added, cause: "", correction: "" });
    }
    await updateRow("job_cards", j.id, {
      complaints,
      status: j.status === "Open" ? "In Progress" : j.status,
      history: j.status === "Open" ? [...j.history, event("In Progress", "Diagnosis started")] : j.history,
    });
    refresh();
    return succeeded("Diagnosis saved");
  });
}

export async function addLabour(jobId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const j = await loadJob(jobId);
    if (!j) return gone("job card");
    if (!editable(j)) return failed(`A ${j.status.toLowerCase()} job card is locked`);
    const description = str(fd, "description", 120);
    if (!description) return failed("Describe the work");
    const hours = num(fd, "hours", 0.25, 24);
    if (hours === null) return failed("Hours must be between 0.25 and 24");
    const billTo = oneOf(fd, "billTo", JOB_BILL_TO) ?? "Customer";
    const labour = [...j.labour, { description, hours: Math.round(hours * 100) / 100, rate: LABOUR_RATE, billTo }];
    await updateRow("job_cards", j.id, { labour, status: j.status === "Open" ? "In Progress" : j.status });
    refresh();
    return succeeded("Labour added", `${hours}h · ${billTo}`);
  });
}

/** Issues a part straight off spare-parts stock onto the card. */
export async function issuePart(jobId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const j = await loadJob(jobId);
    if (!j) return gone("job card");
    if (!editable(j)) return failed(`A ${j.status.toLowerCase()} job card is locked`);
    const { data } = await readMany(["spare_parts"] as const);
    const part = data.spare_parts.find((p) => p.id === str(fd, "partId", 64));
    if (!part) return failed("Choose a part");
    const quantity = int(fd, "quantity", 1, 50);
    if (quantity === null) return failed("Quantity must be 1–50");
    const billTo = oneOf(fd, "billTo", JOB_BILL_TO) ?? "Customer";
    if (part.onHand < quantity) {
      await updateRow("job_cards", j.id, { status: "Awaiting Parts", history: [...j.history, event("Awaiting Parts", `${quantity} × ${part.name} — ${part.onHand} in stock`)] });
      refresh();
      return failed(`Only ${part.onHand} ${part.name} in stock`, "The card is marked Awaiting Parts. Receive stock under Spare Parts Inventory, then issue again.");
    }

    await updateRow("spare_parts", part.id, { onHand: part.onHand - quantity });
    await logMovement({ entity: "Spare Part", reference: `${part.sku} → ${j.jobNo}`, direction: "OUT", quantity, bucket: "Service Issue" });
    const parts = [...j.parts, { partId: part.id, sku: part.sku, name: part.name, hsn: PART_HSN[part.category], quantity, unitPrice: part.unitPrice, billTo }];
    await updateRow("job_cards", j.id, { parts, status: j.status === "Awaiting Parts" || j.status === "Open" ? "In Progress" : j.status });
    refresh();
    return succeeded(`${quantity} × ${part.name} issued`, `${part.onHand - quantity} left in stock · ${billTo}`);
  });
}

/** Returns an issued part to stock — the card line goes, the stock comes back. */
export async function returnPart(jobId: string, indexArg: unknown): Promise<ActionResult> {
  return saving(async () => {
    const j = await loadJob(jobId);
    if (!j) return gone("job card");
    if (!editable(j)) return failed(`A ${j.status.toLowerCase()} job card is locked`);
    const index = typeof indexArg === "number" && Number.isInteger(indexArg) ? indexArg : -1;
    const line = j.parts[index];
    if (!line) return failed("That part is not on the card");
    const { data } = await readMany(["spare_parts"] as const);
    const part = data.spare_parts.find((p) => p.id === line.partId);
    if (part) await updateRow("spare_parts", part.id, { onHand: part.onHand + line.quantity });
    await logMovement({ entity: "Spare Part", reference: `${line.sku} ← ${j.jobNo}`, direction: "IN", quantity: line.quantity, bucket: "Service Return" });
    await updateRow("job_cards", j.id, { parts: j.parts.filter((_, i) => i !== index) });
    refresh();
    return succeeded(`${line.quantity} × ${line.name} back in stock`);
  });
}

export async function markJobReady(jobId: string): Promise<ActionResult> {
  return saving(async () => {
    const j = await loadJob(jobId);
    if (!j) return gone("job card");
    if (j.status !== "In Progress") return failed(j.status === "Awaiting Parts" ? "Parts are still awaited" : "Only a job in progress can be marked ready");
    if (j.complaints.some((c) => !c.correction)) return failed("Record the correction for every complaint", "The 3C — complaint, cause, correction — closes each one.");
    if (!j.labour.length && !j.parts.length) return failed("Add the labour or parts first");
    await updateRow("job_cards", j.id, { status: "Ready", history: [...j.history, event("Ready", "Work complete, road-tested")] });
    if (j.phone) {
      await sendMessage({
        channel: "WhatsApp",
        template: "job_ready",
        to: j.phone,
        customer: j.customer,
        vars: [j.customer, j.model, j.jobNo],
        related: { kind: "job_card", id: j.id, label: j.jobNo },
      });
    }
    refresh();
    return succeeded(`${j.jobNo} ready for pickup`, j.phone ? "The customer has been told on WhatsApp." : undefined);
  });
}

/** Close: bill the customer's share, claim the warranty share, and set the next service. */
export async function closeJobCard(jobId: string): Promise<ActionResult> {
  return saving(async () => {
    const j = await loadJob(jobId);
    if (!j) return gone("job card");
    if (j.status !== "Ready") return failed("Mark the job ready first");
    const { data } = await readMany(["dealers", "warranty_claims", "spare_parts", "vehicle_units", "bookings", "deliveries", "registrations", "job_cards"] as const);
    const dealer = data.dealers.find((d) => d.name === j.dealer);

    const customerLines: QuoteLine[] = [
      ...j.labour
        .filter((l) => l.billTo === "Customer")
        .map((l): QuoteLine => ({ kind: "Accessory", description: `Labour — ${l.description} (${l.hours}h)`, hsn: HSN.workshopLabour, quantity: 1, unitPrice: Math.round(l.hours * l.rate), gstRate: GST_RATE_STANDARD })),
      ...j.parts
        .filter((p) => p.billTo === "Customer")
        .map((p): QuoteLine => ({ kind: "Accessory", description: `${p.name} (${p.sku})`, hsn: p.hsn, quantity: p.quantity, unitPrice: p.unitPrice, gstRate: GST_RATE_STANDARD })),
    ];
    let invoiceNo = "";
    let taxInvoiceId: string | null = null;
    if (customerLines.length) {
      const invoice = await issueTaxInvoice({
        kind: "Service",
        dealer: j.dealer,
        customer: j.customer,
        customerGstin: null,
        placeOfSupply: dealer?.state ?? "Maharashtra",
        lines: customerLines,
        discount: 0,
        subsidy: 0,
        jobCardId: j.id,
        vins: [j.vin],
      });
      taxInvoiceId = invoice.id;
      invoiceNo = invoice.invoiceNo;
    }

    const warrantyParts = j.parts.filter((p) => p.billTo === "Warranty");
    const warrantyValue = warrantyParts.reduce((s, p) => s + p.quantity * p.unitPrice, 0) + j.labour.filter((l) => l.billTo === "Warranty").reduce((s, l) => s + Math.round(l.hours * l.rate), 0);
    let claimNo = "";
    let warrantyClaimId: string | null = null;
    if (warrantyValue > 0) {
      // Through the same intake as a claim typed in on Warranty Claims, so the rules adjudicate it on arrival.
      const claim = await fileClaim({
        dealer: j.dealer,
        vin: j.vin,
        component: claimComponent(warrantyParts, data.spare_parts),
        claimedAmount: warrantyValue,
        customer: j.customer,
        customerPhone: j.phone,
        issue: j.complaints.map((c) => [c.complaint, c.cause && `cause: ${c.cause}`].filter(Boolean).join(" — ")).join("; ") || null,
        odometerKm: j.odometerKm,
        measuredSohPct: null,
        chargerType: null,
        jobCardId: j.id,
        source: "Job card",
        note: `From job card ${j.jobNo}`,
      });
      warrantyClaimId = claim.id;
      claimNo = `${claim.claimNo} (${claim.status.toLowerCase()})`;
    }

    const onRoad = vehiclesOnRoad(data).find((v) => v.unit.vin === j.vin);
    const freeDone = (onRoad?.freeServicesDone ?? 0) + (j.serviceType === "Free Service" ? 1 : 0);
    const next = nextService(onRoad?.deliveredAt ?? j.openedAt, freeDone, { at: new Date().toISOString(), km: j.odometerKm });
    await updateRow("job_cards", j.id, {
      status: "Closed",
      closedAt: new Date().toISOString(),
      taxInvoiceId,
      warrantyClaimId,
      nextServiceAt: next.dueAt,
      nextServiceKm: next.dueKm,
      history: [...j.history, event("Closed", [invoiceNo && `Invoice ${invoiceNo}`, claimNo && `warranty claim ${claimNo}`].filter(Boolean).join(" · ") || "Nothing to bill")],
    });
    refresh();
    const customerTotal = customerLines.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice * (1 + l.gstRate / 100)), 0);
    return succeeded(
      `${j.jobNo} closed`,
      [invoiceNo && `${invoiceNo} for ${rupees(customerTotal)}`, claimNo && `claim ${claimNo} for ${rupees(warrantyValue)}`, `next: ${next.label} by ${next.dueKm.toLocaleString("en-IN")} km`]
        .filter(Boolean)
        .join(" · ")
    );
  });
}

export async function setAwaitingParts(jobId: string): Promise<ActionResult> {
  return saving(async () => {
    const j = await loadJob(jobId);
    if (!j) return gone("job card");
    if (j.status !== "In Progress" && j.status !== "Open") return failed("Only a live job can wait on parts");
    await updateRow("job_cards", j.id, { status: "Awaiting Parts", history: [...j.history, event("Awaiting Parts")] });
    refresh();
    return succeeded(`${j.jobNo} waiting on parts`);
  });
}

export async function cancelJobCard(jobId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const j = await loadJob(jobId);
    if (!j) return gone("job card");
    if (j.status === "Closed" || j.status === "Cancelled") return failed(`Already ${j.status.toLowerCase()}`);
    const reason = str(fd, "reason", 300);
    if (reason.length < 3) return failed("Say why the job is cancelled");
    const { data } = await readMany(["spare_parts"] as const);
    // One card can carry the same part on several lines — a top-up issue, or a
    // split between customer and warranty — so the returns are summed per part.
    // Writing per line would compute each from the same stale figure and leave
    // the shelf short of what the ledger says went back.
    const returning = new Map<string, number>();
    for (const line of j.parts) {
      returning.set(line.partId, (returning.get(line.partId) ?? 0) + line.quantity);
      await logMovement({ entity: "Spare Part", reference: `${line.sku} ← ${j.jobNo}`, direction: "IN", quantity: line.quantity, bucket: "Service Return" });
    }
    for (const [partId, quantity] of returning) {
      const part = data.spare_parts.find((p) => p.id === partId);
      if (part) await updateRow("spare_parts", partId, { onHand: part.onHand + quantity });
    }
    await updateRow("job_cards", j.id, { status: "Cancelled", parts: [], history: [...j.history, event("Cancelled", reason)] });
    refresh();
    return succeeded(`${j.jobNo} cancelled`, j.parts.length ? "Issued parts are back in stock." : reason);
  });
}

/** A service reminder on WhatsApp for a vehicle coming due. */
export async function sendServiceReminder(vehicleUnitId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(vehicleUnitId)) return gone("vehicle");
    const { data } = await readMany(["vehicle_units", "bookings", "deliveries", "registrations", "job_cards"] as const);
    const v = vehiclesOnRoad(data).find((x) => x.unit.id === vehicleUnitId);
    if (!v) return gone("vehicle");
    if (!v.phone) return failed("No mobile number on record for this owner");
    const message = await sendMessage({
      channel: "WhatsApp",
      template: "service_reminder",
      to: v.phone,
      customer: v.customer,
      vars: [v.customer, v.unit.model, v.registrationNo ?? v.unit.vin, v.next.label, new Date(v.next.dueAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })],
      related: { kind: "vehicle", id: v.unit.id, label: v.registrationNo ?? v.unit.vin },
    });
    refresh();
    return message.status === "Failed" ? failed("The reminder did not go", message.error ?? undefined) : succeeded(`Reminder sent to ${v.customer}`, `${v.next.label} due ${new Date(v.next.dueAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`);
  });
}
