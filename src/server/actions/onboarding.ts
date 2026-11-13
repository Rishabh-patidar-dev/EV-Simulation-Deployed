"use server";

import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { complianceStatus } from "@/lib/compliance";
import { INDIAN_STATES, derivedGstin, isValidGstin, rupees, stateOfGstin } from "@/lib/gst";
import {
  APPLICATION_SOURCES,
  CREDIT_MULTIPLE,
  INVESTMENT_BANDS,
  ONBOARDING_STAGES,
  SECURITY_DEPOSIT,
  blockingDocs,
  seedStage,
} from "@/lib/onboarding";
import { OPERATOR } from "@/lib/operator";
import { DEFAULT_CREDIT_DAYS } from "@/lib/receivables";
import { RTO_STATE_CODES } from "@/lib/rto";
import { runtimeId } from "../ids";
import { assignableStaff } from "../staff";
import { deleteRow, insertRow, readMany, updateRow } from "../store";
import type { Application, Approval, ComplianceRecord, Dealer, WorkflowEvent } from "../types";
import { ensureTemplate, sendMessage } from "../workflows/messaging";
import { openApplication } from "../workflows/onboarding";
import { gone, int, isId, oneOf, phoneField, refresh, str, type Prev } from "./input";
import { saving } from "./outcome";

/**
 * Dealer onboarding — EV-CRM's onboarding controller: an application moves
 * forward one stage at a time, and only once every required document of the
 * stage it is in has been verified. Entering Approval raises a Dealer
 * Onboarding request in the approvals queue; signing the agreement, with the
 * security deposit in, puts the dealer on the network with its compliance
 * file and an opening credit limit. Every step lands in the application's
 * history, and the applicant hears about a hold or a rejection.
 */

const DAY = 86_400_000;
const TIERS = ["Platinum", "Gold", "Silver", "Bronze"] as const;
const KYC_TYPES = ["PAN", "GST Certificate", "Aadhaar", "Trade Licence", "Bank Proof", "Premises Photo"] as const;
const INTENTS = ["Dealer", "Distributor", "Service Partner"] as const;
const PAN_SHAPE = /^[A-Z]{5}\d{4}[A-Z]$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UPDATE_TEMPLATE = "application_update";
const UPDATE_BODY = "Dear {{1}}, an update on your Luxus Green dealership application {{2}}: {{3}}";

const event = (status: string, note?: string): WorkflowEvent => ({ status, at: new Date().toISOString(), by: OPERATOR.name, ...(note ? { note } : {}) });

async function load(appId: string) {
  if (!isId(appId)) return null;
  const { data } = await readMany(["applications", "kyc_documents", "dealers", "approvals"] as const);
  const app = data.applications.find((a) => a.id === appId);
  return app ? { app, data } : null;
}

/** Tells the applicant on WhatsApp — the CRM emails them at the same moments. */
async function tellApplicant(app: Application, text: string): Promise<string> {
  if (!app.phone) return "";
  await ensureTemplate(UPDATE_TEMPLATE, UPDATE_BODY);
  const m = await sendMessage({
    channel: "WhatsApp",
    template: UPDATE_TEMPLATE,
    to: app.phone,
    customer: app.contactName ?? app.firm,
    vars: [app.contactName ?? app.firm, app.applicationNo, text],
    related: { kind: "application", id: app.id, label: app.applicationNo },
  });
  return m.status === "Failed" ? ` The WhatsApp update did not go (${m.error}).` : " The applicant was told on WhatsApp.";
}

type Contact = Pick<Application, "contactName" | "phone" | "email" | "gstin" | "pan" | "investment" | "source">;

function readContact(fd: FormData): Contact | ActionResult {
  const contactName = str(fd, "contactName", 80);
  if (contactName.length < 2) return failed("Who is the contact person?");
  const phoneRaw = str(fd, "phone", 20);
  const phone = phoneRaw ? phoneField(fd, "phone") : null;
  if (phoneRaw && !phone) return failed("That phone number is not valid");
  const email = str(fd, "email", 120).toLowerCase() || null;
  if (email && !EMAIL_SHAPE.test(email)) return failed("That email address is not valid");
  if (!phone && !email) return failed("Give a phone or an email", "The applicant must be reachable.");
  const gstin = str(fd, "gstin", 15).toUpperCase() || null;
  if (gstin && !isValidGstin(gstin)) return failed("That GSTIN is not valid");
  let pan = str(fd, "pan", 10).toUpperCase() || null;
  if (pan && !PAN_SHAPE.test(pan)) return failed("That PAN is not valid");
  if (gstin && pan && gstin.slice(2, 12) !== pan) return failed("The PAN does not match the GSTIN");
  if (gstin && !pan) pan = gstin.slice(2, 12);
  return {
    contactName,
    phone,
    email,
    gstin,
    pan,
    investment: oneOf(fd, "investment", INVESTMENT_BANDS),
    source: oneOf(fd, "source", APPLICATION_SOURCES),
  };
}

const isResult = (v: unknown): v is ActionResult => typeof v === "object" && v !== null && "ok" in v && "at" in v;

/**
 * A new application. It opens at Enquiry with the stage's checklist and the
 * six Digital KYC documents, all still to collect.
 */
export async function createApplication(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const firm = str(fd, "firm", 80);
    if (!firm) return failed("Name the firm");
    const city = str(fd, "city", 60);
    if (!city) return failed("Which city?");
    const contact = readContact(fd);
    if (isResult(contact)) return contact;
    const state = contact.gstin ? (stateOfGstin(contact.gstin) ?? "") : oneOf(fd, "state", INDIAN_STATES);
    if (!state) return failed("Choose a state from the list");
    const intent = oneOf(fd, "intent", INTENTS);
    if (!intent) return failed("Dealer, distributor or service partner?");

    const { data } = await readMany(["applications", "dealers"] as const);
    if (data.applications.some((a) => a.firm.toLowerCase() === firm.toLowerCase() && (a.status === "In Progress" || a.status === "On Hold"))) {
      return failed(`${firm} already has an open application`);
    }
    if (data.dealers.some((d) => d.name.toLowerCase() === firm.toLowerCase())) return failed(`${firm} is already a dealer on the network`);
    if (contact.gstin && data.applications.some((a) => a.gstin === contact.gstin && a.status !== "Rejected")) return failed("Another application has that GSTIN");

    const owner = oneOf(fd, "owner", await assignableStaff("onboarding.manage")) ?? OPERATOR.name;
    const application = await openApplication({ firm, city, state, intent, owner, ...contact });
    refresh();
    return succeeded(`Application ${application.applicationNo} opened`, `${firm}, ${city} · ${application.stageDocs!.length} screening documents and ${KYC_TYPES.length} KYC documents to collect.`);
  });
}

/** Correct what was taken down when the application was opened. */
export async function updateApplication(appId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const firm = str(fd, "firm", 80);
    if (!firm) return failed("Name the firm");
    const city = str(fd, "city", 60);
    if (!city) return failed("Which city?");
    const contact = readContact(fd);
    if (isResult(contact)) return contact;
    const state = contact.gstin ? (stateOfGstin(contact.gstin) ?? "") : oneOf(fd, "state", INDIAN_STATES);
    if (!state) return failed("Choose a state from the list");
    const intent = oneOf(fd, "intent", INTENTS);
    if (!intent) return failed("Dealer, distributor or service partner?");
    const owner = oneOf(fd, "owner", await assignableStaff("onboarding.manage"));
    if (!owner) return failed("Choose an owner from the list", "They may have been deactivated since the page loaded.");

    const loaded = await load(appId);
    if (!loaded) return gone("application");
    const { app, data } = loaded;
    if (app.status === "Approved") return failed("An onboarded application can't be edited", "Change the dealer's own record instead.");

    await updateRow("applications", app.id, { firm, city, state, intent, owner, ...contact, history: [...(app.history ?? []), event("Details updated")] });
    // The KYC checklist carries the firm's name, so it moves with it.
    if (firm !== app.firm) for (const doc of data.kyc_documents.filter((d) => d.applicationNo === app.applicationNo)) await updateRow("kyc_documents", doc.id, { firm });
    refresh();
    return succeeded(`${app.applicationNo} updated`, `${firm}, ${city}`);
  });
}

/** Withdraw an application opened by mistake, as long as nothing has been collected. */
export async function deleteApplication(appId: string): Promise<ActionResult> {
  return saving(async () => {
    const loaded = await load(appId);
    if (!loaded) return gone("application");
    const { app, data } = loaded;
    if (app.status === "Approved" || data.dealers.some((d) => d.name.toLowerCase() === app.firm.toLowerCase())) return failed("This application is already onboarded");
    const docs = data.kyc_documents.filter((d) => d.applicationNo === app.applicationNo);
    if (docs.some((d) => d.status !== "Not Uploaded") || (app.stageDocs ?? []).some((d) => d.status !== "Not Uploaded")) {
      return failed("Documents have already been collected", "Reject the application instead — the documents stay on file.");
    }
    await deleteRow("applications", app.id);
    for (const doc of docs) await deleteRow("kyc_documents", doc.id);
    refresh();
    return succeeded(`Application ${app.applicationNo} withdrawn`, app.firm);
  });
}

/** One checklist document: received, verified, or rejected with what is wrong. */
export async function setStageDoc(appId: string, key: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const loaded = await load(appId);
    if (!loaded) return gone("application");
    const { app } = loaded;
    if (app.status === "Approved" || app.status === "Rejected") return failed(`The application is ${app.status.toLowerCase()}`);
    const status = oneOf(fd, "status", ["Received", "Verified", "Rejected"] as const);
    if (!status) return failed("Received, verified or rejected?");
    const docs = app.stageDocs ?? [];
    const doc = docs.find((d) => d.key === key);
    if (!doc) return gone("document");
    if (status === "Verified" && doc.status !== "Received") return failed("Receive the document before verifying it");
    const note = str(fd, "note", 300) || null;
    if (status === "Rejected" && !note) return failed("Say what is wrong with it", "The applicant is told, so they can send it again.");

    const at = new Date().toISOString();
    const stageDocs = docs.map((d) => (d.key === key ? { ...d, status, note, at, by: OPERATOR.name } : d));
    await updateRow("applications", app.id, { stageDocs, history: [...(app.history ?? []), event(`${doc.label} — ${status.toLowerCase()}`, note ?? undefined)] });
    const told = status === "Rejected" ? await tellApplicant(app, `please send "${doc.label}" again — ${note}`) : "";
    refresh();
    return succeeded(`${doc.label}: ${status.toLowerCase()}`, `${app.firm}.${told}`);
  });
}

/**
 * One stage on. Every required document of the current stage must be
 * verified (and, leaving Verification, all six KYC documents). Entering
 * Approval raises the sign-off request; leaving it needs that request approved.
 */
export async function advanceApplication(appId: string): Promise<ActionResult> {
  return saving(async () => {
    const loaded = await load(appId);
    if (!loaded) return gone("application");
    const { app, data } = loaded;
    if (app.status !== "In Progress") return failed(`A ${app.status.toLowerCase()} application can't move`);
    if (app.stage === "Agreement") return failed("Sign the agreement to onboard the dealer");

    // An application from before stage checklists: give its stage one now, and collect it before moving on.
    if (!(app.stageDocs ?? []).some((d) => d.stage === app.stage) && STAGE_HAS_DOCS(app.stage)) {
      await updateRow("applications", app.id, { stageDocs: [...(app.stageDocs ?? []), ...seedStage(app.stage)] });
      refresh();
      return failed(`${app.stage} now has its checklist`, "Collect and verify those documents, then move on.");
    }
    const blocking = blockingDocs(app);
    if (blocking.length) return failed(`${blocking.length} required document${blocking.length === 1 ? "" : "s"} not verified`, blocking.map((d) => d.label).join("; "));
    if (app.stage === "Verification") {
      const kyc = data.kyc_documents.filter((d) => d.applicationNo === app.applicationNo);
      const open = kyc.filter((d) => d.status !== "Verified");
      if (!kyc.length || open.length) return failed("Digital KYC is not complete", open.length ? `Not verified: ${open.map((d) => d.docType).join(", ")}` : "No KYC documents on file.");
    }
    if (app.stage === "Approval") {
      const approval = data.approvals.find((a) => a.id === app.approvalId);
      if ((approval?.status ?? "Pending") !== "Approved") return failed("Waiting for the Head of Network Development", "Decide the Dealer Onboarding request in the approvals queue.");
    }

    const next = ONBOARDING_STAGES[ONBOARDING_STAGES.indexOf(app.stage) + 1];
    const at = new Date().toISOString();
    let approvalId = app.approvalId ?? null;
    if (next === "Approval") {
      const approval: Approval = {
        id: runtimeId("APR"),
        type: "Dealer Onboarding",
        subject: `${app.applicationNo} · ${app.firm}`,
        requestedBy: app.owner,
        pendingWith: "Head of Network Development",
        raisedAt: at,
        ageingHours: 0,
        status: "Pending",
        link: { kind: "application", id: app.id },
        detail: `${app.intent} in ${app.city}, ${app.state}${app.investment ? ` · investment ${app.investment}` : ""} — due diligence and KYC verified`,
      };
      await insertRow("approvals", approval);
      approvalId = approval.id;
    }
    await updateRow("applications", app.id, {
      stage: next,
      stageEnteredAt: at,
      approvalId,
      stageDocs: [...(app.stageDocs ?? []).filter((d) => d.stage !== next), ...seedStage(next)],
      history: [...(app.history ?? []), event(next, next === "Approval" ? "Sent to the Head of Network Development" : undefined)],
    });
    refresh();
    return succeeded(`${app.firm} moved to ${next}`, next === "Approval" ? "A Dealer Onboarding request is in the approvals queue." : `${seedStage(next).length} documents to collect.`);
  });
}

const STAGE_HAS_DOCS = (stage: Application["stage"]) => seedStage(stage).length > 0;

export async function setApplicationStatus(appId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const loaded = await load(appId);
    if (!loaded) return gone("application");
    const { app, data } = loaded;
    const status = oneOf(fd, "status", ["In Progress", "On Hold", "Rejected"] as const);
    if (!status) return failed("Choose what happens to the application");
    if (app.status === "Approved") return failed("The dealer is already onboarded");
    if (app.status === status) return failed(`Already ${status.toLowerCase()}`);
    const reason = str(fd, "reason", 300);
    if (status !== "In Progress" && reason.length < 3) return failed("Give the reason", "The applicant is told.");

    // Rejecting while a sign-off request is open withdraws it.
    const approval = data.approvals.find((a) => a.id === app.approvalId);
    if (status === "Rejected" && approval && (approval.status ?? "Pending") === "Pending") {
      await updateRow("approvals", approval.id, { status: "Rejected", decidedBy: OPERATOR.name, decidedAt: new Date().toISOString(), note: "Withdrawn — the application was rejected" });
    }
    await updateRow("applications", app.id, {
      status,
      reason: status === "In Progress" ? null : reason,
      history: [...(app.history ?? []), event(status === "In Progress" ? "Resumed" : status, reason || undefined)],
    });
    const told = status === "In Progress" ? "" : await tellApplicant(app, status === "On Hold" ? `it is on hold — ${reason}` : `we are unable to proceed — ${reason}`);
    refresh();
    return succeeded(`${app.firm}: ${status === "In Progress" ? "resumed" : status.toLowerCase()}`, `${reason}${told}`.trim() || undefined);
  });
}

/** The security deposit, in before the agreement is signed. */
export async function recordSecurityDeposit(appId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const loaded = await load(appId);
    if (!loaded) return gone("application");
    const { app } = loaded;
    if (app.stage !== "Agreement" || app.status !== "In Progress") return failed("The deposit is taken at the Agreement stage");
    const minimum = SECURITY_DEPOSIT[app.intent];
    const amount = int(fd, "amount", minimum, 100_000_000);
    if (amount === null) return failed(`The deposit for a ${app.intent.toLowerCase()} is at least ${rupees(minimum)}`);
    const reference = str(fd, "reference", 40).toUpperCase();
    if (reference.length < 6) return failed("Enter the UTR or bank guarantee number");
    const at = new Date().toISOString();
    const stageDocs = (app.stageDocs ?? []).map((d) => (d.key === "SECURITY_DEPOSIT_PROOF" && d.status !== "Verified" ? { ...d, status: "Received" as const, note: reference, at, by: OPERATOR.name } : d));
    await updateRow("applications", app.id, { securityDeposit: { amount, reference, at }, stageDocs, history: [...(app.history ?? []), event("Security deposit received", `${rupees(amount)} · ${reference}`)] });
    refresh();
    return succeeded(`${rupees(amount)} deposit recorded`, "Verify the proof on the checklist, then sign.");
  });
}

/**
 * Signing onboards the dealer: a Dealer 360 record with an opening credit
 * limit from its deposit, and its first compliance file.
 */
export async function signAgreement(appId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const loaded = await load(appId);
    if (!loaded) return gone("application");
    const { app, data } = loaded;
    if (app.stage !== "Agreement" || app.status !== "In Progress") return failed("The application must be at Agreement, in progress");
    if (data.dealers.some((d) => d.name === app.firm)) return failed(`${app.firm} is already a dealer`);
    if ((app.stageDocs ?? []).some((d) => d.stage === "Agreement")) {
      const blocking = blockingDocs(app);
      if (blocking.length) return failed("The agreement file is not complete", blocking.map((d) => d.label).join("; "));
      if (!app.securityDeposit) return failed("The security deposit has not been recorded");
    }
    const tier = oneOf(fd, "tier", TIERS) ?? "Bronze";
    const targetUnits = int(fd, "targetUnits", 0, 10_000) ?? 60;

    const stateCode = RTO_STATE_CODES[app.state] ?? "XX";
    const inState = data.dealers.filter((d) => d.state === app.state).length;
    const deposit = app.securityDeposit?.amount ?? null;
    const dealer: Dealer = {
      id: runtimeId("DLR"),
      code: `LX${stateCode}${String(inState + 1).padStart(3, "0")}`,
      name: app.firm,
      city: app.city,
      state: app.state,
      tier,
      status: "Active",
      ytdUnits: 0,
      targetUnits,
      outstanding: 0,
      health: 70,
      gstin: app.gstin ?? derivedGstin(app.firm, app.state),
      securityDeposit: deposit,
      creditLimit: deposit ? deposit * CREDIT_MULTIPLE : null,
      creditDays: DEFAULT_CREDIT_DAYS,
    };
    await insertRow("dealers", dealer);

    const now = Date.now();
    const file: Array<[ComplianceRecord["docType"], number]> = [
      ["Dealer Agreement", 3 * 365],
      ["GST Registration", 5 * 365],
      ["Trade Licence", 365],
      ["Shop Insurance", 365],
    ];
    for (const [docType, days] of file) {
      const expiresOn = new Date(now + days * DAY).toISOString();
      await insertRow("compliance", {
        id: runtimeId("CMP"),
        dealer: dealer.name,
        docType,
        reference: docType === "GST Registration" ? dealer.gstin! : `${docType.split(" ").map((w) => w[0]).join("")}-${app.applicationNo.replace(/\D/g, "")}`,
        expiresOn,
        status: complianceStatus(expiresOn),
      });
    }
    await updateRow("applications", app.id, { status: "Approved", dealerId: dealer.id, history: [...(app.history ?? []), event("Onboarded", `Dealer ${dealer.code} · ${tier} · target ${targetUnits} units`)] });
    const told = await tellApplicant(app, `welcome to the Luxus Green network — your dealer code is ${dealer.code}`);
    refresh();
    return succeeded(
      `${app.firm} is on the network`,
      `Dealer code ${dealer.code} · ${tier} · target ${targetUnits} units${dealer.creditLimit ? ` · credit limit ${rupees(dealer.creditLimit)}` : ""}.${told}`
    );
  });
}
