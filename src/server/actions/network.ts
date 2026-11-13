"use server";

import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { RENEWAL_WINDOW_DAYS, complianceStatus } from "@/lib/compliance";
import { isValidGstin, stateOfGstin } from "@/lib/gst";
import { OPERATOR } from "@/lib/operator";
import { runtimeId } from "../ids";
import { deleteRow, insertRow, readMany, updateRow } from "../store";
import type { ComplianceRecord, Dealer, DocumentRecord } from "../types";
import { dateField, gone, int, isId, oneOf, refresh, str, type Prev } from "./input";
import { saving } from "./outcome";
import { dealerContact, ensureTemplate, sendMessage } from "../workflows/messaging";

/**
 * The dealer network's own records: Digital KYC for applications, the live
 * dealers, their compliance documents, and the document register. The
 * onboarding pipeline itself is in onboarding.ts.
 */

const TIERS = ["Platinum", "Gold", "Silver", "Bronze"] as const;

// ---------------------------------------------------------------------------
// Dealers & compliance
// ---------------------------------------------------------------------------

/** A resized square thumbnail, as produced by DealerImageField. */
const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
/** 160k characters of base64 is ~120 KB — far above what a 256px thumbnail needs. */
const LOGO_MAX_CHARS = 160_000;

/**
 * The media type in a data URL is a label the sender chooses, so the bytes
 * decide: only a real PNG, JPEG or WebP is stored.
 */
function hasImageBytes(kind: string, bytes: Buffer): boolean {
  if (kind === "png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (kind === "jpeg") return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length > 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
}

export async function setDealerLogo(dealerId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(dealerId)) return gone("dealer");
    // The picker only ever sends a new image, so "remove" has to say so.
    if (fd.get("intent") === "clear") {
      const cleared = await updateRow("dealers", dealerId, { logo: null });
      if (!cleared) return gone("dealer");
      refresh();
      return succeeded(`${cleared.name} image removed`);
    }

    const logo = String(fd.get("logo") ?? "").trim();
    if (!logo) return failed("Choose an image first");
    // Length first: everything below this decodes the payload.
    if (logo.length > LOGO_MAX_CHARS) return failed("That image is too large", "Pick a smaller file — the picker resizes to 256px.");
    const declared = LOGO_DATA_URL.exec(logo);
    if (!declared) return failed("That is not a PNG, JPEG or WebP image");
    if (!hasImageBytes(declared[1], Buffer.from(logo.slice(logo.indexOf(",") + 1), "base64"))) {
      return failed("That is not a PNG, JPEG or WebP image");
    }

    const updated = await updateRow("dealers", dealerId, { logo });
    if (!updated) return gone("dealer");
    refresh();
    return succeeded(`${updated.name} image updated`);
  });
}

export async function updateDealer(dealerId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(dealerId)) return gone("dealer");
    const { data } = await readMany(["dealers"] as const);
    const dealer = data.dealers.find((d) => d.id === dealerId);
    if (!dealer) return gone("dealer");
    const tier = oneOf(fd, "tier", TIERS);
    const status = oneOf(fd, "status", ["Active", "Onboarding", "Suspended"] as const);
    const targetUnits = int(fd, "targetUnits", 0, 10_000);
    if (!tier || !status || targetUnits === null) return failed("Choose a tier and status, and a target of 0–10,000 units");
    const gstin = str(fd, "gstin", 15).toUpperCase();
    if (gstin && !isValidGstin(gstin)) return failed("That GSTIN is not valid");
    if (gstin && stateOfGstin(gstin) !== dealer.state) return failed(`The GSTIN is registered in ${stateOfGstin(gstin)}`, `${dealer.name} trades in ${dealer.state}.`);
    const patch: Partial<Dealer> = { tier, status, targetUnits, ...(gstin ? { gstin } : {}) };
    await updateRow("dealers", dealer.id, patch);
    refresh();
    const changes = [tier !== dealer.tier && `tier ${tier}`, status !== dealer.status && status.toLowerCase(), targetUnits !== dealer.targetUnits && `target ${targetUnits}`].filter(Boolean);
    return succeeded(`${dealer.name} updated`, changes.join(" · ") || undefined);
  });
}

export async function renewCompliance(recordId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(recordId)) return gone("record");
    const reference = str(fd, "reference", 40);
    if (reference.length < 3) return failed("Enter the new document's reference");
    const expiresOn = dateField(fd, "expiresOn");
    if (!expiresOn || new Date(expiresOn).getTime() <= Date.now()) return failed("The new expiry must be in the future");
    const { data } = await readMany(["compliance"] as const);
    const current = data.compliance.find((c) => c.id === recordId);
    if (!current) return gone("record");
    // The renewal keeps what it replaced, so the file shows every term the dealer has held.
    const renewals = [...(current.renewals ?? []), { reference: current.reference, expiresOn: current.expiresOn, renewedAt: new Date().toISOString(), by: OPERATOR.name }];
    const updated = await updateRow("compliance", recordId, {
      reference,
      expiresOn,
      status: complianceStatus(expiresOn),
      issuedOn: dateField(fd, "issuedOn") ?? new Date().toISOString(),
      notes: str(fd, "notes", 300) || current.notes || null,
      renewals,
    });
    if (!updated) return gone("record");
    refresh();
    return succeeded(`${updated.docType} renewed`, `${updated.dealer} · valid to ${new Date(expiresOn).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`);
  });
}

const COMPLIANCE_TYPES = ["Trade Licence", "GST Registration", "Dealer Agreement", "Fire NOC", "Shop Insurance"] as const;

/** A compliance document a dealer did not have on file yet. */
export async function addCompliance(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const dealer = str(fd, "dealer", 80);
    const docType = oneOf(fd, "docType", COMPLIANCE_TYPES);
    if (!docType) return failed("Choose the document");
    const reference = str(fd, "reference", 40);
    if (reference.length < 3) return failed("Enter the document's reference");
    const expiresOn = dateField(fd, "expiresOn");
    if (!expiresOn || new Date(expiresOn).getTime() <= Date.now()) return failed("The expiry must be in the future");

    const { data } = await readMany(["dealers", "compliance"] as const);
    if (!data.dealers.some((d) => d.name === dealer)) return failed("Choose a dealer from the list");
    if (data.compliance.some((c) => c.dealer === dealer && c.docType === docType)) {
      return failed(`${dealer} already has a ${docType} on file`, "Renew that one instead.");
    }

    const issuedOn = dateField(fd, "issuedOn");
    if (issuedOn && new Date(issuedOn).getTime() > Date.now()) return failed("The issue date can't be in the future");
    const record: ComplianceRecord = {
      id: runtimeId("CMP"),
      dealer,
      docType,
      reference,
      expiresOn,
      status: complianceStatus(expiresOn),
      issuedOn,
      notes: str(fd, "notes", 300) || null,
      renewals: [],
      reminders: [],
    };
    await insertRow("compliance", record);
    refresh();
    return succeeded(`${docType} filed for ${dealer}`, `Reference ${reference}`);
  });
}

/** A document filed by mistake. */
export async function deleteCompliance(recordId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(recordId)) return gone("record");
    const { data } = await readMany(["compliance"] as const);
    const record = data.compliance.find((c) => c.id === recordId);
    if (!record) return gone("record");
    await deleteRow("compliance", recordId);
    refresh();
    return succeeded(`${record.docType} removed`, record.dealer);
  });
}

// ---------------------------------------------------------------------------
// Onboarding & KYC
// ---------------------------------------------------------------------------

export async function markKycUploaded(docId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(docId)) return gone("document");
    const { data } = await readMany(["kyc_documents"] as const);
    const doc = data.kyc_documents.find((d) => d.id === docId);
    if (!doc) return gone("document");
    if (doc.status !== "Not Uploaded" && doc.status !== "Rejected") return failed("Already received");
    await updateRow("kyc_documents", doc.id, { status: "Pending", uploadedAt: new Date().toISOString(), verifiedBy: null });
    refresh();
    return succeeded(`${doc.docType} received from ${doc.firm}`, "Verify it next.");
  });
}

export async function verifyKyc(docId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(docId)) return gone("document");
    const decision = oneOf(fd, "decision", ["Verified", "Rejected"] as const);
    if (!decision) return failed("Verify or reject");
    const { data } = await readMany(["kyc_documents"] as const);
    const doc = data.kyc_documents.find((d) => d.id === docId);
    if (!doc) return gone("document");
    if (doc.status !== "Pending") return failed(doc.status === "Not Uploaded" ? "Nothing uploaded yet" : `Already ${doc.status.toLowerCase()}`);
    await updateRow("kyc_documents", doc.id, { status: decision, verifiedBy: decision === "Verified" ? OPERATOR.name : null });
    refresh();
    return succeeded(`${doc.docType} ${decision.toLowerCase()}`, doc.firm);
  });
}

// ---------------------------------------------------------------------------
// Document register
// ---------------------------------------------------------------------------

export async function setDocumentStatus(docId: string, statusArg: unknown): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(docId)) return gone("document");
    const status = statusArg === "Verified" || statusArg === "Archived" || statusArg === "Pending" ? statusArg : null;
    if (!status) return failed("Verify, archive or reopen");
    const updated = await updateRow("documents", docId, { status });
    if (!updated) return gone("document");
    refresh();
    return succeeded(`${updated.name}: ${status.toLowerCase()}`);
  });
}

export async function registerDocument(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const name = str(fd, "name", 120);
    if (name.length < 3) return failed("Name the document");
    const kind = oneOf(fd, "kind", ["KYC", "Agreement", "Invoice", "Compliance", "Claim"] as const);
    if (!kind) return failed("Choose the kind of document");
    const linkedTo = str(fd, "linkedTo", 80);
    if (!linkedTo) return failed("Say what it belongs to — a dealer, an application, an invoice");
    const sizeKb = int(fd, "sizeKb", 1, 51_200) ?? 250;
    const doc: DocumentRecord = { id: runtimeId("DOC"), name, kind, linkedTo, owner: OPERATOR.name, sizeKb, uploadedAt: new Date().toISOString(), status: "Pending" };
    await insertRow("documents", doc);
    refresh();
    return succeeded(`${name} registered`, "Pending verification.");
  });
}

// ---------------------------------------------------------------------------
// Renewal reminders — EV-CRM's compliance "remind", sent for real here.
// ---------------------------------------------------------------------------

const REMINDER_TEMPLATE = "compliance_renewal";
const REMINDER_BODY = "Dear {{1}}, your {{2}} ({{3}}) on file with Luxus Green {{4}}. Please send the renewed document to keep ordering without interruption.";

async function remindRecord(record: ComplianceRecord): Promise<{ ok: boolean; error: string | null }> {
  await ensureTemplate(REMINDER_TEMPLATE, REMINDER_BODY);
  const contact = await dealerContact(record.dealer);
  const at = new Date().toISOString();
  const days = Math.round((new Date(record.expiresOn).getTime() - Date.now()) / 86_400_000);
  if (!contact) {
    const error = "No active dealer login with a phone number — add one in User Management";
    await updateRow("compliance", record.id, { reminders: [...(record.reminders ?? []), { at, by: OPERATOR.name, to: "—", status: "Failed", error }] });
    return { ok: false, error };
  }
  const m = await sendMessage({
    channel: "WhatsApp",
    template: REMINDER_TEMPLATE,
    to: contact.phone,
    customer: record.dealer,
    vars: [contact.name, record.docType, record.reference, days < 0 ? `expired ${Math.abs(days)} days ago` : `expires in ${days} days`],
    related: { kind: "compliance", id: record.id, label: `${record.docType} · ${record.dealer}` },
  });
  const status = m.status === "Failed" ? "Failed" : "Sent";
  await updateRow("compliance", record.id, { reminders: [...(record.reminders ?? []), { at, by: OPERATOR.name, to: `${contact.name} · ${contact.phone}`, status, error: m.error }] });
  return { ok: status === "Sent", error: m.error };
}

export async function sendComplianceReminder(recordId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(recordId)) return gone("record");
    const { data } = await readMany(["compliance"] as const);
    const record = data.compliance.find((c) => c.id === recordId);
    if (!record) return gone("record");
    if (complianceStatus(record.expiresOn) === "Valid") return failed("Not due yet", `The renewal window opens ${RENEWAL_WINDOW_DAYS} days before expiry.`);
    const r = await remindRecord(record);
    refresh();
    return r.ok ? succeeded(`Reminder sent to ${record.dealer}`, `${record.docType} · ${record.reference}`) : failed("The reminder did not go", r.error ?? undefined);
  });
}

/** Every expired or expiring document not reminded in the last week. */
export async function remindAllDue(): Promise<ActionResult> {
  return saving(async () => {
    const { data } = await readMany(["compliance"] as const);
    const recent = (c: ComplianceRecord) => (c.reminders ?? []).some((r) => r.status === "Sent" && Date.now() - new Date(r.at).getTime() < 7 * 86_400_000);
    const due = data.compliance.filter((c) => complianceStatus(c.expiresOn) !== "Valid" && !recent(c));
    if (!due.length) return failed("Nothing to remind", "Every lapsing document was reminded in the last week, or none is due.");
    let sent = 0;
    let lastError: string | null = null;
    for (const record of due) {
      const r = await remindRecord(record);
      if (r.ok) sent++;
      else lastError = r.error;
    }
    refresh();
    return sent === due.length ? succeeded(`${sent} reminder${sent === 1 ? "" : "s"} sent`, "On WhatsApp to each dealer's contact.") : failed(`${sent} of ${due.length} reminders sent`, lastError ?? undefined);
  });
}
