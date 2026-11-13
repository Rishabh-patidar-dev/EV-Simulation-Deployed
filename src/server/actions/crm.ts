"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { OPERATOR } from "@/lib/operator";
import { INDIAN_STATES } from "@/lib/gst";
import { isEmail, isPincode, rescore, scoreLead } from "@/lib/leads";
import { VEHICLE_MODELS } from "@/lib/vehicles";
import { runtimeId } from "../ids";
import { nextNumber } from "../numbering";
import { assignableStaff } from "../staff";
import { phoneField } from "./input";
import { deleteRow, insertRow, readCollection, readMany, updateRow } from "../store";
import { BOOKING_STAGES, DEAL_STAGES } from "../types";
import type { Booking, Campaign, Deal, Enquiry, FollowUp, LandingPage, Lead, LeadRemark, Segment, SegmentFilter } from "../types";
import { ACTIVE_LOAN, cancelBookingCascade, openDelivery } from "../workflows/bookings";
import { saving } from "./outcome";

/**
 * Every CRM mutation in the simulation, in one file.
 *
 * Each is the action of an ActionForm (useActionState under the hood): it
 * takes the previous result and the submitted FormData — after any ids bound
 * with `.bind(null, id)` — and reports what actually happened, so the toast a
 * user sees is the database's answer rather than an assumption. After a
 * write, the routes that could be showing the changed data are revalidated.
 */

type Prev = ActionResult | null;

const CRM_PATHS = [
  "/",
  "/crm/leads",
  "/crm/leads/unassigned",
  "/crm/leads/assigned",
  "/crm/leads/segments",
  "/crm/enquiries",
  "/crm/pipeline",
  "/crm/bookings",
  "/crm/follow-ups",
  "/crm/campaigns",
  "/crm/campaigns/landing-pages",
  "/erp/analytics",
];

function touch(extraPaths: string[] = []) {
  for (const path of [...CRM_PATHS, ...extraPaths]) revalidatePath(path);
}

const GONE = (what: string) => failed(`That ${what} no longer exists`, "Someone may have removed it — refresh to see the current list.");

// ---------------------------------------------------------------------------
// Input handling. Every exported action is a public POST endpoint — callable
// directly, not only through these forms — so nothing it receives is trusted:
// not the form fields, and not the ids bound with `.bind(null, id)`, which
// travel from the browser like any other argument.
// ---------------------------------------------------------------------------

const MAX_TEXT = 200;
const MAX_NOTE = 2000;
const MAX_MONEY = 10_000_000_000;

const LEAD_SOURCES = ["Landing Page", "WhatsApp", "Walk-in", "Referral", "Dealer", "Call Centre", "Expo", "Import"] as const satisfies readonly Lead["source"][];
const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Test Drive", "Converted", "Lost"] as const satisfies readonly Lead["status"][];
const SEGMENT_CHANNELS = ["Email", "WhatsApp", "SMS", "Mixed"] as const satisfies readonly Segment["channel"][];
const ENQUIRY_STATUSES = ["Open", "Responded", "Quoted", "Closed"] as const satisfies readonly Enquiry["status"][];
const ENQUIRY_CHANNELS = ["Landing Page", "WhatsApp", "Phone", "Walk-in"] as const satisfies readonly Enquiry["channel"][];
const FOLLOW_UP_CHANNELS = ["Call", "WhatsApp", "Visit", "Email"] as const satisfies readonly FollowUp["channel"][];
const CAMPAIGN_CHANNELS = ["Email", "WhatsApp", "Landing Page", "SMS"] as const satisfies readonly Campaign["channel"][];
const CAMPAIGN_STATUSES = ["Running", "Scheduled", "Completed", "Paused"] as const satisfies readonly Campaign["status"][];
const LANDING_PAGE_STATUSES = ["Live", "Draft", "Archived"] as const satisfies readonly LandingPage["status"][];

/** The original ids (`LEAD-0001`, `CMP-DOC-0042`) and runtime ids (`LEAD-M1X2AB3C`) both fit. */
const isId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9-]{1,64}$/.test(value);

/** Trimmed and length-capped, so one request cannot park megabytes in a row. */
const str = (fd: FormData, key: string, max = MAX_TEXT) => String(fd.get(key) ?? "").trim().slice(0, max);

const num = (fd: FormData, key: string, fallback = 0, min = 0, max = MAX_MONEY) => {
  const v = Number(fd.get(key));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
};

/** The field's value if it is one of `allowed`, otherwise null — never an arbitrary string cast to the union. */
function oneOf<T extends string>(fd: FormData, key: string, allowed: readonly T[]): T | null {
  const v = str(fd, key);
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** ISO timestamp for a date field, or null when it is missing or not a real date (instead of a RangeError). */
function dateField(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  if (!v) return null;
  const date = new Date(v);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

/** The contact and profile fields shared by add and edit — each checked, so the score is worked out on clean data. */
function readProfile(fd: FormData):
  | { phone: string; phoneDigits: string | null; email: string | null; city: string; state: string | null; pincode: string | null; model: string | null }
  | string {
  const phone = phoneField(fd, "phone");
  if (!phone) return "Enter a 10-digit mobile number — Indian mobiles start with 6, 7, 8 or 9";
  const email = str(fd, "email", 120).toLowerCase() || null;
  if (email && !isEmail(email)) return "That email address is not valid";
  const pincode = str(fd, "pincode", 6) || null;
  if (pincode && !isPincode(pincode)) return "A pincode is six digits";
  const state = str(fd, "state") ? oneOf(fd, "state", INDIAN_STATES) : null;
  if (str(fd, "state") && !state) return "Choose a state from the list";
  return { phone, phoneDigits: phone.replace(/\D/g, "").slice(-10), email, city: str(fd, "city"), state, pincode, model: oneOf(fd, "model", VEHICLE_MODELS) };
}

/** Another lead with the same mobile or email — the CRM refuses duplicates on both. */
function findDuplicate(leads: Lead[], phoneDigits: string | null, email: string | null, except?: string): Lead | undefined {
  return leads.find(
    (l) => l.id !== except && ((phoneDigits && l.phone.replace(/\D/g, "").slice(-10) === phoneDigits) || (email && l.email?.toLowerCase() === email))
  );
}

export async function createLead(_prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    const name = str(formData, "name");
    if (!name) return failed("A name is required");

    // Blank means unassigned; a name that is not on the list is refused
    // rather than quietly dropped.
    const assignedTo = oneOf(formData, "assignedTo", await assignableStaff("leads.manage"));
    if (str(formData, "assignedTo") && !assignedTo) return failed("Choose an owner from the list", "They may have been deactivated since the page loaded.");
    const dealer = str(formData, "dealer") || null;
    const now = new Date().toISOString();
    const profile = readProfile(formData);
    if (typeof profile === "string") return failed(profile);
    const { data } = await readMany(["leads"] as const);
    const dupe = findDuplicate(data.leads, profile.phoneDigits, profile.email);
    if (dupe) return failed(`${dupe.name} already has that phone or email`, "Open the existing lead instead of adding a second one.");
    const scored = scoreLead({ name, phone: profile.phone, email: profile.email, city: profile.city, state: profile.state, pincode: profile.pincode, model: profile.model ?? undefined });

    const lead: Lead = {
      id: runtimeId("LEAD"),
      name,
      // A valid mobile is stored as "+91 98765 43210", the way every other module stores it.
      phone: profile.phone,
      city: profile.city || "Unspecified",
      model: profile.model ?? "LX EV Cargo",
      source: oneOf(formData, "source", LEAD_SOURCES) ?? "Landing Page",
      status: assignedTo ? "Contacted" : "New",
      assignedTo,
      dealer,
      email: profile.email,
      state: profile.state,
      pincode: profile.pincode,
      scoreBreakdown: scored,
      routing: dealer ? { by: "Manual", why: null, at: now } : null,
      score: scored.base,
      value: num(formData, "value", 125_000),
      createdAt: now,
      updatedAt: now,
      nextAction: str(formData, "nextAction") || "Call back",
      dealId: null,
    };

    await insertRow("leads", lead);
    touch([`/crm/leads/${lead.id}`]);
    return succeeded(
      `Lead added — ${name} (score ${scored.base})`,
      `${assignedTo ? `Assigned to ${assignedTo}.` : "Waiting in Unassigned Leads."}${scored.missing.length ? ` Missing: ${scored.missing.join(", ")}.` : ""}`
    );
  });
}

export async function updateLeadStatus(leadId: string, _prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    const status = oneOf(formData, "status", LEAD_STATUSES);
    if (!isId(leadId)) return GONE("lead");
    if (!status) return failed("Choose a valid status");
    if (!(await updateRow("leads", leadId, { status, updatedAt: new Date().toISOString() }))) return GONE("lead");
    touch([`/crm/leads/${leadId}`]);
    return succeeded(`Status set to ${status}`);
  });
}

export async function assignLead(leadId: string, _prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    const assignedTo = oneOf(formData, "assignedTo", await assignableStaff("leads.manage"));
    const dealer = str(formData, "dealer");
    if (!isId(leadId)) return GONE("lead");
    if (!assignedTo || !dealer) return failed("Choose an owner and a dealer");

    const { rows } = await readCollection("leads");
    const lead = rows.find((l) => l.id === leadId);
    if (!lead) return GONE("lead");
    const nextStatus: Lead["status"] = lead.status === "New" ? "Contacted" : lead.status;

    const at = new Date().toISOString();
    await updateRow("leads", leadId, { assignedTo, dealer, status: nextStatus, updatedAt: at, routing: { by: "Manual", why: null, at } });
    touch([`/crm/leads/${leadId}`]);
    return succeeded(`Assigned to ${assignedTo}`, dealer);
  });
}

export async function markLeadLost(leadId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(leadId) || !(await updateRow("leads", leadId, { status: "Lost", updatedAt: new Date().toISOString() }))) return GONE("lead");
    touch([`/crm/leads/${leadId}`]);
    return succeeded("Lead marked lost");
  });
}

/** Correct a lead's own details — a wrong number, the model asked for, what it is worth. */
export async function updateLead(leadId: string, _prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(leadId)) return GONE("lead");
    const name = str(formData, "name");
    if (!name) return failed("A name is required");
    const profile = readProfile(formData);
    if (typeof profile === "string") return failed(profile);
    if (!profile.model) return failed("Choose a model from the list");
    const source = oneOf(formData, "source", LEAD_SOURCES);
    if (!source) return failed("Choose a source from the list");

    const { data } = await readMany(["leads"] as const);
    const lead = data.leads.find((l) => l.id === leadId);
    if (!lead) return GONE("lead");
    const dupe = findDuplicate(data.leads, profile.phoneDigits, profile.email, leadId);
    if (dupe) return failed(`${dupe.name} already has that phone or email`, "Merge by keeping one lead and marking the other lost.");
    const scored = scoreLead({ name, phone: profile.phone, email: profile.email, city: profile.city, state: profile.state, pincode: profile.pincode, model: profile.model ?? undefined });
    const score = rescore(lead, scored);

    const patch = {
      name,
      phone: profile.phone,
      email: profile.email,
      city: profile.city || "Unspecified",
      state: profile.state,
      pincode: profile.pincode,
      model: profile.model,
      source,
      score,
      scoreBreakdown: scored,
      value: num(formData, "value", 125_000),
      nextAction: str(formData, "nextAction") || "Call back",
      updatedAt: new Date().toISOString(),
    };
    if (!(await updateRow("leads", leadId, patch))) return GONE("lead");
    touch([`/crm/leads/${leadId}`]);
    return succeeded("Lead updated", score !== lead.score ? `${name} · score ${lead.score} → ${score}` : name);
  });
}

/**
 * Deleting a lead is for a duplicate or a junk capture. One that has already
 * produced work — a deal, a quotation, a test drive — is kept and marked lost
 * instead, so nothing downstream is left pointing at a row that has gone.
 */
export async function deleteLead(leadId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(leadId)) return GONE("lead");
    const { data } = await readMany(["leads", "deals", "quotations", "test_drives", "enquiries", "lead_remarks"] as const);
    const lead = data.leads.find((l) => l.id === leadId);
    if (!lead) return GONE("lead");

    const blocking =
      (data.deals.some((d) => d.leadId === leadId) && "a deal in the pipeline") ||
      (data.quotations.some((q) => q.leadId === leadId) && "a quotation") ||
      (data.test_drives.some((t) => t.leadId === leadId) && "a test drive");
    if (blocking) return failed(`This lead has ${blocking}`, "Mark it lost instead — deleting it would orphan that record.");

    await deleteRow("leads", leadId);
    for (const remark of data.lead_remarks.filter((r) => r.leadId === leadId)) await deleteRow("lead_remarks", remark.id);
    // An enquiry that produced this lead goes back to having none.
    for (const enquiry of data.enquiries.filter((e) => e.leadId === leadId)) await updateRow("enquiries", enquiry.id, { leadId: null, status: "Open" });
    touch();
    return succeeded(`Lead deleted — ${lead.name}`, "Its notes went with it.");
  });
}

export async function addLeadRemark(leadId: string, _prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    const note = str(formData, "note", MAX_NOTE);
    if (!isId(leadId)) return GONE("lead");
    if (!note) return failed("Write a note first");
    const author = oneOf(formData, "author", await assignableStaff("leads.manage")) ?? OPERATOR.name;

    // Touch the lead first: if it has gone, the note is not written against nothing.
    if (!(await updateRow("leads", leadId, { updatedAt: new Date().toISOString() }))) return GONE("lead");
    const remark: LeadRemark = { id: runtimeId("RMK"), leadId, author, note, createdAt: new Date().toISOString() };
    await insertRow("lead_remarks", remark);
    touch([`/crm/leads/${leadId}`]);
    return succeeded("Note added", `Logged by ${author}.`);
  });
}

/** Fix a typo in a note. The author and the time it was logged do not change. */
export async function updateLeadRemark(remarkId: string, _prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(remarkId)) return GONE("note");
    const note = str(formData, "note", MAX_NOTE);
    if (!note) return failed("The note can't be empty");
    const updated = await updateRow("lead_remarks", remarkId, { note });
    if (!updated) return GONE("note");
    touch([`/crm/leads/${updated.leadId}`]);
    return succeeded("Note updated");
  });
}

export async function deleteLeadRemark(remarkId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(remarkId)) return GONE("note");
    const { rows } = await readCollection("lead_remarks");
    const remark = rows.find((r) => r.id === remarkId);
    if (!remark) return GONE("note");
    await deleteRow("lead_remarks", remarkId);
    touch([`/crm/leads/${remark.leadId}`]);
    return succeeded("Note deleted");
  });
}

/**
 * The CRM → pipeline handoff: converting a lead creates a real Deal row
 * (rather than just flipping a status) so the pipeline board, the booking it
 * eventually produces, and the delivered vehicle can all be traced back to
 * the lead that started them.
 */
export async function convertLeadToDeal(leadId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(leadId)) return GONE("lead");
    const { rows } = await readCollection("leads");
    const lead = rows.find((l) => l.id === leadId);
    if (!lead) return GONE("lead");
    if (lead.dealId) return failed("Already converted", "This lead already has a deal on the pipeline.");

    const now = new Date().toISOString();
    const deal: Deal = {
      id: runtimeId("DEAL"),
      leadId: lead.id,
      customer: lead.name,
      phone: lead.phone,
      dealer: lead.dealer ?? "Unassigned",
      model: lead.model,
      stage: "Qualified",
      value: lead.value,
      ageingDays: 0,
      expectedClose: new Date(Date.now() + 21 * 86_400_000).toISOString(),
      createdAt: now,
      bookingId: null,
    };

    await insertRow("deals", deal);
    await updateRow("leads", leadId, { status: "Converted", dealId: deal.id, updatedAt: now });
    touch([`/crm/leads/${leadId}`]);
    return succeeded("Converted to a deal", `${lead.name} is on the Pipeline Board as Qualified.`);
  });
}

// ---------------------------------------------------------------------------
// Segments — `filter` is the live query; size is computed at read time.
// ---------------------------------------------------------------------------

export async function createSegment(_prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    const name = str(formData, "name");
    if (!name) return failed("Give the segment a name");

    const filter: SegmentFilter = {};
    const source = oneOf(formData, "source", LEAD_SOURCES);
    const status = oneOf(formData, "status", LEAD_STATUSES);
    const city = str(formData, "city");
    if (source) filter.source = source;
    if (status) filter.status = status;
    if (city) filter.city = city;
    if (str(formData, "minScore")) filter.minScore = num(formData, "minScore", 0, 0, 100);

    const segment: Segment = {
      id: runtimeId("SEG"),
      name,
      filter,
      channel: oneOf(formData, "channel", SEGMENT_CHANNELS) ?? "Email",
      createdBy: OPERATOR.name,
      updatedAt: new Date().toISOString(),
    };
    await insertRow("segments", segment);
    touch();
    return succeeded(`Segment created — ${name}`);
  });
}

export async function deleteSegment(segmentId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(segmentId)) return GONE("segment");
    await deleteRow("segments", segmentId);
    touch();
    return succeeded("Segment deleted");
  });
}

/** Rename a segment or re-cut it — the filter is the segment. */
export async function updateSegment(segmentId: string, _prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(segmentId)) return GONE("segment");
    const name = str(formData, "name");
    if (!name) return failed("Give the segment a name");

    const filter: SegmentFilter = {};
    const source = oneOf(formData, "source", LEAD_SOURCES);
    const status = oneOf(formData, "status", LEAD_STATUSES);
    const city = str(formData, "city");
    if (source) filter.source = source;
    if (status) filter.status = status;
    if (city) filter.city = city;
    if (str(formData, "minScore")) filter.minScore = num(formData, "minScore", 0, 0, 100);

    const patch = { name, filter, channel: oneOf(formData, "channel", SEGMENT_CHANNELS) ?? "Email", updatedAt: new Date().toISOString() };
    if (!(await updateRow("segments", segmentId, patch))) return GONE("segment");
    touch();
    return succeeded("Segment updated", name);
  });
}

// ---------------------------------------------------------------------------
// Enquiries
// ---------------------------------------------------------------------------

export async function createEnquiry(_prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    const customer = str(formData, "customer");
    if (!customer) return failed("A customer name is required");
    const phone = phoneField(formData, "phone");
    if (!phone) return failed("Enter a 10-digit mobile number", "Indian mobiles start with 6, 7, 8 or 9.");
    const channel = oneOf(formData, "channel", ENQUIRY_CHANNELS);
    if (!channel) return failed("Choose how the enquiry came in");
    const model = oneOf(formData, "model", VEHICLE_MODELS);
    if (!model) return failed("Choose a model from the list");

    const { data } = await readMany(["enquiries", "dealers"] as const);
    const dealer = str(formData, "dealer");
    if (!dealer || !data.dealers.some((d) => d.name === dealer)) return failed("Choose a dealer from the list");

    const enquiry: Enquiry = {
      id: runtimeId("ENQ"),
      reference: nextNumber(data.enquiries.map((e) => e.reference), "ENQ", 1200),
      customer,
      phone,
      model,
      channel,
      dealer,
      status: "Open",
      value: num(formData, "value", 125_000),
      createdAt: new Date().toISOString(),
      leadId: null,
    };
    await insertRow("enquiries", enquiry);
    touch();
    return succeeded(`Enquiry logged — ${enquiry.reference}`, `${customer} · ${model} · ${dealer}`);
  });
}

/** Correct what was taken down on the call. */
export async function updateEnquiry(enquiryId: string, _prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(enquiryId)) return GONE("enquiry");
    const customer = str(formData, "customer");
    if (!customer) return failed("A customer name is required");
    const phone = phoneField(formData, "phone");
    if (!phone) return failed("Enter a 10-digit mobile number", "Indian mobiles start with 6, 7, 8 or 9.");
    const model = oneOf(formData, "model", VEHICLE_MODELS);
    if (!model) return failed("Choose a model from the list");

    const patch = { customer, phone, model, value: num(formData, "value", 125_000) };
    if (!(await updateRow("enquiries", enquiryId, patch))) return GONE("enquiry");
    touch();
    return succeeded("Enquiry updated", customer);
  });
}

/** For a wrong number or a duplicate. One already converted keeps its lead, so it stays. */
export async function deleteEnquiry(enquiryId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(enquiryId)) return GONE("enquiry");
    const { rows } = await readCollection("enquiries");
    const enquiry = rows.find((e) => e.id === enquiryId);
    if (!enquiry) return GONE("enquiry");
    if (enquiry.leadId) return failed("This enquiry became a lead", "Delete the lead first if it was a mistake.");
    await deleteRow("enquiries", enquiryId);
    touch();
    return succeeded(`Enquiry deleted — ${enquiry.reference}`);
  });
}

export async function updateEnquiryStatus(enquiryId: string, _prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    const status = oneOf(formData, "status", ENQUIRY_STATUSES);
    if (!isId(enquiryId)) return GONE("enquiry");
    if (!status) return failed("Choose a valid status");
    if (!(await updateRow("enquiries", enquiryId, { status }))) return GONE("enquiry");
    touch();
    return succeeded(`Enquiry marked ${status.toLowerCase()}`);
  });
}

const CHANNEL_TO_SOURCE: Record<Enquiry["channel"], Lead["source"]> = {
  "Landing Page": "Landing Page",
  WhatsApp: "WhatsApp",
  Phone: "Call Centre",
  "Walk-in": "Walk-in",
};

export async function convertEnquiryToLead(enquiryId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(enquiryId)) return GONE("enquiry");
    const [{ rows: enquiries }, { rows: dealers }] = await Promise.all([readCollection("enquiries"), readCollection("dealers")]);
    const enquiry = enquiries.find((e) => e.id === enquiryId);
    if (!enquiry) return GONE("enquiry");
    if (enquiry.leadId) return failed("Already a lead", "This enquiry was converted earlier.");

    const dealerRow = dealers.find((d) => d.name === enquiry.dealer);
    const now = new Date().toISOString();
    const scored = scoreLead({ name: enquiry.customer, phone: enquiry.phone, email: enquiry.email, city: enquiry.city ?? dealerRow?.city, state: dealerRow?.state, model: enquiry.model });
    const lead: Lead = {
      id: runtimeId("LEAD"),
      name: enquiry.customer,
      phone: enquiry.phone,
      city: enquiry.city ?? dealerRow?.city ?? "Unspecified",
      model: enquiry.model,
      source: CHANNEL_TO_SOURCE[enquiry.channel],
      status: "Contacted",
      assignedTo: null,
      dealer: enquiry.dealer,
      state: dealerRow?.state ?? null,
      scoreBreakdown: scored,
      routing: { by: "Manual", why: "From the enquiry's dealer", at: now },
      // The page and campaign that produced the enquiry stay with the lead, so its results are attributed.
      email: enquiry.email ?? null,
      landingPageId: enquiry.landingPageId ?? null,
      campaignId: enquiry.campaignId ?? null,
      score: scored.base,
      value: enquiry.value,
      createdAt: now,
      updatedAt: now,
      nextAction: "Call back",
      dealId: null,
    };

    await insertRow("leads", lead);
    await updateRow("enquiries", enquiryId, { status: "Closed", leadId: lead.id });
    touch([`/crm/leads/${lead.id}`]);
    return succeeded("Enquiry converted to a lead", `${lead.name} is now in the Lead Master.`);
  });
}

// ---------------------------------------------------------------------------
// Pipeline (deals) — advancing into "Booked" produces a real Booking, the
// same CRM → DMS handoff convertLeadToDeal performs one step earlier.
// ---------------------------------------------------------------------------

export async function createDeal(_prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    const customer = str(formData, "customer");
    if (!customer) return failed("A customer name is required");

    const deal: Deal = {
      id: runtimeId("DEAL"),
      leadId: null,
      customer,
      // A valid mobile is stored as "+91 98765 43210", the way every other module stores it.
      phone: phoneField(formData, "phone") ?? (str(formData, "phone", 32) || "+91 90000 00000"),
      dealer: str(formData, "dealer") || "Unassigned",
      model: oneOf(formData, "model", VEHICLE_MODELS) ?? "LX EV Cargo",
      stage: "Qualified",
      value: num(formData, "value", 150_000),
      ageingDays: 0,
      expectedClose: new Date(Date.now() + 21 * 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
      bookingId: null,
    };
    await insertRow("deals", deal);
    touch();
    return succeeded("Deal added to the pipeline", `${customer} · Qualified`);
  });
}

export async function advanceDealStage(dealId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(dealId)) return GONE("deal");
    const { rows } = await readCollection("deals");
    const deal = rows.find((d) => d.id === dealId);
    if (!deal) return GONE("deal");

    const idx = DEAL_STAGES.indexOf(deal.stage);
    if (idx === -1 || idx === DEAL_STAGES.length - 1) return failed("Already booked", "Follow it from Bookings.");
    const nextStage = DEAL_STAGES[idx + 1];

    if (nextStage === "Booked") {
      // Booked without a quotation: the deal's value stands, and the vehicle
      // count comes from the model's price on the list.
      const { data } = await readMany(["bookings", "products"] as const);
      const listPrice = data.products.find((p) => p.model === deal.model)?.variants[0]?.exShowroom;
      const quantity = listPrice ? Math.max(1, Math.round(deal.value / listPrice)) : 1;
      const booking: Booking = {
        id: runtimeId("BKG"),
        bookingNo: nextNumber(data.bookings.map((b) => b.bookingNo), "BKG", 4100),
        dealId: deal.id,
        customer: deal.customer,
        dealer: deal.dealer,
        model: deal.model,
        token: Math.round(deal.value * 0.1),
        total: deal.value,
        status: "Confirmed",
        bookedAt: new Date().toISOString(),
        deliveryEta: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        vehicleUnitId: null,
        quantity,
        unitPrice: Math.round(deal.value / quantity),
        phone: deal.phone,
        quotationId: null,
      };
      await insertRow("bookings", booking);
      await updateRow("deals", dealId, { stage: nextStage, bookingId: booking.id, ageingDays: 0 });
      // The originating lead (if any) is converted the moment its deal books.
      if (deal.leadId) await updateRow("leads", deal.leadId, { status: "Converted", updatedAt: new Date().toISOString() });
      touch([`/dms/orders`, `/dms/inventory/vehicles`]);
      return succeeded("Deal booked", `Booking ${booking.bookingNo} created for ${deal.customer}.`);
    }

    await updateRow("deals", dealId, { stage: nextStage, ageingDays: 0 });
    touch([`/dms/orders`, `/dms/inventory/vehicles`]);
    return succeeded(`Moved to ${nextStage}`, deal.customer);
  });
}

export async function revertDealStage(dealId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(dealId)) return GONE("deal");
    const { rows } = await readCollection("deals");
    const deal = rows.find((d) => d.id === dealId);
    if (!deal) return GONE("deal");
    if (deal.stage === "Booked") return failed("A booked deal can't move back", "Cancel its booking from Bookings instead.");
    const idx = DEAL_STAGES.indexOf(deal.stage);
    if (idx <= 0) return failed("Already at the first stage");
    await updateRow("deals", dealId, { stage: DEAL_STAGES[idx - 1] });
    touch();
    return succeeded(`Moved back to ${DEAL_STAGES[idx - 1]}`, deal.customer);
  });
}

/** The negotiated number and the date it is expected to land both move; the stage does not. */
export async function updateDeal(dealId: string, _prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(dealId)) return GONE("deal");
    const customer = str(formData, "customer");
    if (!customer) return failed("A customer name is required");
    const expectedClose = dateField(formData, "expectedClose");
    if (!expectedClose) return failed("Pick an expected close date");

    const patch = { customer, value: num(formData, "value", 125_000), expectedClose };
    if (!(await updateRow("deals", dealId, patch))) return GONE("deal");
    touch();
    return succeeded("Deal updated", customer);
  });
}

/** A deal opened by mistake. Once it has a quotation or a booking behind it, it stays. */
export async function deleteDeal(dealId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(dealId)) return GONE("deal");
    const { data } = await readMany(["deals", "quotations"] as const);
    const deal = data.deals.find((d) => d.id === dealId);
    if (!deal) return GONE("deal");
    if (deal.bookingId) return failed("This deal is booked", "Cancel the booking from Bookings first.");
    if (data.quotations.some((q) => q.dealId === dealId)) return failed("This deal has a quotation", "Decline the quotation first.");

    await deleteRow("deals", dealId);
    if (deal.leadId) await updateRow("leads", deal.leadId, { dealId: null, status: "Qualified", updatedAt: new Date().toISOString() });
    touch();
    return succeeded(`Deal deleted — ${deal.customer}`, deal.leadId ? "Its lead is back at Qualified." : undefined);
  });
}

// ---------------------------------------------------------------------------
// Bookings — a booking waits on its loan (Finance & Insurance) and completes
// only through a handover (Vehicle Delivery), so the stock, the tax invoice
// and the registration can never disagree with it.
// ---------------------------------------------------------------------------

export async function advanceBookingStatus(bookingId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(bookingId)) return GONE("booking");
    const { data } = await readMany(["bookings", "finance_cases", "deliveries"] as const);
    const booking = data.bookings.find((b) => b.id === bookingId);
    if (!booking) return GONE("booking");
    if (booking.status === "Cancelled") return failed("This booking was cancelled");

    const idx = BOOKING_STAGES.indexOf(booking.status as (typeof BOOKING_STAGES)[number]);
    if (idx === -1 || idx === BOOKING_STAGES.length - 1) return failed("Already delivered");
    const nextStatus = BOOKING_STAGES[idx + 1];

    if (nextStatus === "Delivered") {
      const delivery = data.deliveries.find((d) => d.bookingId === booking.id && d.status !== "Cancelled");
      return failed("Hand it over in Vehicle Delivery", delivery ? `Delivery ${delivery.deliveryNo} is ${delivery.status.toLowerCase()} — PDI, insurance and the customer's OTP complete it.` : "Open its delivery there: PDI, insurance and the customer's OTP complete the booking.");
    }
    if (nextStatus === "Ready for Delivery") {
      const loan = data.finance_cases.find((c) => c.bookingId === booking.id && (ACTIVE_LOAN as readonly string[]).includes(c.status));
      if (loan) return failed(`Loan ${loan.caseNo} is ${loan.status.toLowerCase()}`, `The booking is released when ${loan.financier} disburses — see Finance & Insurance.`);
    }

    await updateRow("bookings", bookingId, { status: nextStatus });
    let detail = `${booking.bookingNo} · ${booking.customer}`;
    if (nextStatus === "Ready for Delivery") {
      const delivery = await openDelivery({ ...booking, status: nextStatus });
      detail = `Delivery ${delivery.deliveryNo} opened — allocate the vehicles and run the PDI.`;
    }
    touch(["/dms/orders/delivery", "/dms/finance-insurance"]);
    return succeeded(`Booking moved to ${nextStatus}`, detail);
  });
}

export async function cancelBooking(bookingId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(bookingId)) return GONE("booking");
    const { rows } = await readCollection("bookings");
    const booking = rows.find((b) => b.id === bookingId);
    if (!booking) return GONE("booking");
    if (booking.status === "Delivered") return failed("A delivered booking can't be cancelled", "The vehicles are with the customer — handle a return through the dealer.");
    if (booking.status === "Cancelled") return failed("Already cancelled");
    const undone = await cancelBookingCascade(booking, "Cancelled from Bookings");
    touch(["/dms/orders/delivery", "/dms/finance-insurance", "/dms/inventory/vehicles"]);
    return succeeded("Booking cancelled", undone.length ? undone.join("; ") : undefined);
  });
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export async function createFollowUp(_prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    const subject = str(formData, "subject");
    const customer = str(formData, "customer");
    if (!subject || !customer) return failed("Add a subject and a customer");

    const dueAt = dateField(formData, "dueAt") ?? new Date(Date.now() + 2 * 86_400_000).toISOString();

    await insertRow("follow_ups", {
      id: runtimeId("FUP"),
      subject,
      relatedTo: str(formData, "relatedTo") || "Lead",
      customer,
      owner: oneOf(formData, "owner", await assignableStaff("followups.manage")) ?? OPERATOR.name,
      channel: oneOf(formData, "channel", FOLLOW_UP_CHANNELS) ?? "Call",
      dueAt,
      status: new Date(dueAt) < new Date() ? "Overdue" : "Due",
    });
    touch();
    return succeeded("Follow-up scheduled", `${customer} · due ${new Date(dueAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`);
  });
}

export async function completeFollowUp(followUpId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(followUpId) || !(await updateRow("follow_ups", followUpId, { status: "Done" }))) return GONE("follow-up");
    touch();
    return succeeded("Follow-up completed");
  });
}

export async function rescheduleFollowUp(followUpId: string, _prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    const dueAt = dateField(formData, "dueAt");
    if (!isId(followUpId)) return GONE("follow-up");
    if (!dueAt) return failed("Pick a new date");
    if (!(await updateRow("follow_ups", followUpId, { dueAt, status: new Date(dueAt) < new Date() ? "Overdue" : "Due" }))) return GONE("follow-up");
    touch();
    return succeeded("Follow-up rescheduled", `Due ${new Date(dueAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`);
  });
}

/** Who it is for and what it is about — the date has its own reschedule. */
export async function updateFollowUp(followUpId: string, _prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(followUpId)) return GONE("follow-up");
    const subject = str(formData, "subject");
    if (!subject) return failed("Say what the follow-up is about");
    const customer = str(formData, "customer");
    if (!customer) return failed("Who is it with?");
    const channel = oneOf(formData, "channel", FOLLOW_UP_CHANNELS);
    if (!channel) return failed("Choose a channel");
    const owner = oneOf(formData, "owner", await assignableStaff("followups.manage"));
    if (!owner) return failed("Choose an owner from the list", "They may have been deactivated since the page loaded.");

    if (!(await updateRow("follow_ups", followUpId, { subject, customer, owner, channel }))) return GONE("follow-up");
    touch();
    return succeeded("Follow-up updated", `${subject} · ${owner}`);
  });
}

/** Cancel a follow-up that should not have been booked. */
export async function deleteFollowUp(followUpId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(followUpId)) return GONE("follow-up");
    const { rows } = await readCollection("follow_ups");
    const followUp = rows.find((f) => f.id === followUpId);
    if (!followUp) return GONE("follow-up");
    await deleteRow("follow_ups", followUpId);
    touch();
    return succeeded("Follow-up cancelled", followUp.subject);
  });
}

// ---------------------------------------------------------------------------
// Campaigns & landing pages
// ---------------------------------------------------------------------------

export async function updateCampaignStatus(campaignId: string, _prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    const status = oneOf(formData, "status", CAMPAIGN_STATUSES);
    if (!isId(campaignId)) return GONE("campaign");
    if (!status) return failed("Choose a valid status");
    if (!(await updateRow("campaigns", campaignId, { status }))) return GONE("campaign");
    touch();
    return succeeded(`Campaign ${status === "Running" ? "running" : status.toLowerCase()}`);
  });
}

/** Rename a campaign, move it to another channel, correct what it cost. */
export async function updateCampaign(campaignId: string, _prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(campaignId)) return GONE("campaign");
    const name = str(formData, "name");
    if (!name) return failed("Name the campaign");
    const channel = oneOf(formData, "channel", CAMPAIGN_CHANNELS);
    if (!channel) return failed("Choose a channel");

    if (!(await updateRow("campaigns", campaignId, { name, channel, spend: num(formData, "spend", 0) }))) return GONE("campaign");
    touch();
    return succeeded("Campaign updated", name);
  });
}

/** A campaign that never ran can go; one that has reached people is history and is kept. */
export async function deleteCampaign(campaignId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(campaignId)) return GONE("campaign");
    const { rows } = await readCollection("campaigns");
    const campaign = rows.find((c) => c.id === campaignId);
    if (!campaign) return GONE("campaign");
    if (campaign.status === "Running") return failed("This campaign is running", "Pause it first.");
    if (campaign.reached > 0) return failed("This campaign has already reached people", `${campaign.reached.toLocaleString("en-IN")} contacts and ${campaign.leads} leads are attributed to it.`);
    await deleteRow("campaigns", campaignId);
    touch();
    // Its own page is gone with it — back to the list, which says what went.
    redirect(`/crm/campaigns?deleted=${encodeURIComponent(campaign.name)}`);
  });
}

export async function updateLandingPageStatus(pageId: string, _prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    const status = oneOf(formData, "status", LANDING_PAGE_STATUSES);
    if (!isId(pageId)) return GONE("landing page");
    if (!status) return failed("Choose a valid status");
    if (!(await updateRow("landing_pages", pageId, { status, updatedAt: new Date().toISOString() }))) return GONE("landing page");
    touch();
    return succeeded(status === "Live" ? "Landing page published" : `Landing page ${status.toLowerCase()}`);
  });
}

/** The name and the slug the form posts to. */
export async function updateLandingPage(pageId: string, _prev: Prev, formData: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(pageId)) return GONE("landing page");
    const name = str(formData, "name");
    if (!name) return failed("Name the page");
    const slug = str(formData, "slug", 80).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (slug.length < 3) return failed("Give it a slug", "Lower case, dashes between words — e.g. cargo-offer.");

    const { rows } = await readCollection("landing_pages");
    if (rows.some((p) => p.id !== pageId && p.slug === slug)) return failed(`/${slug} is already taken`);
    if (!(await updateRow("landing_pages", pageId, { name, slug, updatedAt: new Date().toISOString() }))) return GONE("landing page");
    touch();
    return succeeded("Landing page updated", `/${slug}`);
  });
}

/** Only a page that is not live and has taken no submissions. */
export async function deleteLandingPage(pageId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(pageId)) return GONE("landing page");
    const { rows } = await readCollection("landing_pages");
    const page = rows.find((p) => p.id === pageId);
    if (!page) return GONE("landing page");
    if (page.status === "Live") return failed("This page is live", "Archive it first.");
    if (page.submissions > 0) return failed("This page has captured leads", `${page.submissions} submissions came through it.`);
    await deleteRow("landing_pages", pageId);
    touch();
    redirect(`/crm/campaigns/landing-pages?deleted=${encodeURIComponent(page.name)}`);
  });
}
