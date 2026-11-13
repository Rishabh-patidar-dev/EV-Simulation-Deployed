"use server";

import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { OPERATOR } from "@/lib/operator";
import { VEHICLE_MODELS } from "@/lib/vehicles";
import { runtimeId } from "../ids";
import { nextNumber } from "../numbering";
import { insertRow, readMany, updateRow } from "../store";
import type { FollowUp, Lead, LeadRemark, TestDrive } from "../types";
import { sendMessage } from "../workflows/messaging";
import { dateField, gone, int, isId, oneOf, phoneField, refresh, str, type Prev } from "./input";
import { saving } from "./outcome";

/**
 * Test drives — booked against a dealer's demo vehicle for a model, one slot
 * at a time; the driving licence is checked before the keys are handed over;
 * and the feedback goes back onto the lead: a note on its timeline, its score
 * nudged by how keen the customer is, and a follow-up when they are.
 */

const DAY = 86_400_000;
const MINUTE = 60_000;
/** Showroom hours for drives: 9:00 to 18:00, Monday to Saturday (as the dealer network keeps). */
const OPEN_HOUR = 9;
const CLOSE_HOUR = 18;
const BOOKED_VIA = ["Dealer", "Landing Page", "Call Centre", "WhatsApp"] as const;
const ACTIVE: ReadonlyArray<TestDrive["status"]> = ["Scheduled", "Checked In"];

/** Indian driving licence: state code, RTO code, year of issue, serial — "MH14 2011 0062821". */
function normaliseLicence(raw: string): string | null {
  const v = raw.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z]{2}\d{13}$/.test(v)) return null;
  const year = Number(v.slice(4, 8));
  return year >= 1950 && year <= new Date().getFullYear() ? v : null;
}

/** A slot inside showroom hours on a working day — in India time, whatever the server's clock zone. */
function slotProblem(slotAt: Date, durationMin: number): string | null {
  const ist = new Date(slotAt.getTime() + 330 * MINUTE);
  if (ist.getUTCDay() === 0) return "Showrooms don't run drives on Sundays";
  const start = ist.getUTCHours() + ist.getUTCMinutes() / 60;
  if (start < OPEN_HOUR || start + durationMin / 60 > CLOSE_HOUR) return `Drives run ${OPEN_HOUR}:00–${CLOSE_HOUR}:00`;
  return null;
}

/** Another drive on the same demo vehicle that overlaps this slot. */
function clash(drives: TestDrive[], dealer: string, model: string, slotAt: Date, durationMin: number, ignoreId?: string) {
  const start = slotAt.getTime();
  const end = start + durationMin * MINUTE;
  return drives.find((d) => {
    if (d.id === ignoreId || d.dealer !== dealer || d.model !== model || !ACTIVE.includes(d.status)) return false;
    const s = new Date(d.slotAt).getTime();
    return s < end && start < s + d.durationMin * MINUTE;
  });
}

async function loadDrive(driveId: string) {
  if (!isId(driveId)) return null;
  const { data } = await readMany(["test_drives"] as const);
  return data.test_drives.find((d) => d.id === driveId) ?? null;
}

export async function scheduleTestDrive(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const { data } = await readMany(["test_drives", "leads", "dealers"] as const);
    const leadId = str(fd, "leadId", 64);
    const lead = leadId ? data.leads.find((l) => l.id === leadId) : undefined;
    if (leadId && !lead) return failed("That lead no longer exists");

    const customer = str(fd, "customer", 120) || lead?.name || "";
    if (!customer) return failed("Enter the customer's name");
    const phone = phoneField(fd, "phone") ?? lead?.phone ?? null;
    if (!phone) return failed("Enter a valid 10-digit mobile number");
    const model = oneOf(fd, "model", VEHICLE_MODELS) ?? (lead && VEHICLE_MODELS.includes(lead.model) ? lead.model : null);
    if (!model) return failed("Choose the model to drive");
    const dealer = data.dealers.find((d) => d.name === (str(fd, "dealer") || lead?.dealer) && d.status === "Active");
    if (!dealer) return failed("Choose an active dealer — the demo vehicle is theirs");

    const slot = dateField(fd, "slotAt");
    if (!slot) return failed("Choose the date and time");
    const slotAt = new Date(slot);
    if (slotAt.getTime() < Date.now() - 5 * MINUTE) return failed("The slot is in the past");
    if (slotAt.getTime() > Date.now() + 60 * DAY) return failed("Book within the next 60 days");
    const durationMin = int(fd, "durationMin", 15, 120) ?? 30;
    const problem = slotProblem(slotAt, durationMin);
    if (problem) return failed(problem);
    const busy = clash(data.test_drives, dealer.name, model, slotAt, durationMin);
    if (busy) return failed(`The ${model} demo at ${dealer.name} is out then`, `${busy.driveNo} has it from ${new Date(busy.slotAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}.`);

    const licenceRaw = str(fd, "licenceNo", 20);
    const licenceNo = licenceRaw ? normaliseLicence(licenceRaw) : null;
    if (licenceRaw && !licenceNo) return failed("That driving licence number isn't valid", "State code, RTO, year and serial — e.g. MH14 2011 0062821.");

    const drive: TestDrive = {
      id: runtimeId("TD"),
      driveNo: nextNumber(data.test_drives.map((d) => d.driveNo), "TD", 2000),
      leadId: lead?.id ?? null,
      customer,
      phone,
      model,
      dealer: dealer.name,
      slotAt: slotAt.toISOString(),
      durationMin,
      status: "Scheduled",
      bookedVia: oneOf(fd, "bookedVia", BOOKED_VIA) ?? "Dealer",
      licenceNo,
      licenceVerified: false,
      feedback: null,
      createdAt: new Date().toISOString(),
      createdBy: OPERATOR.name,
      completedAt: null,
      cancelReason: null,
    };
    await insertRow("test_drives", drive);
    if (lead && ["New", "Contacted", "Qualified"].includes(lead.status)) {
      await updateRow("leads", lead.id, { status: "Test Drive", nextAction: `Test drive ${drive.driveNo}`, updatedAt: new Date().toISOString() });
    }
    await sendMessage({
      channel: "WhatsApp",
      template: "test_drive_confirmation",
      to: phone,
      customer,
      vars: [customer, model, slotAt.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }), dealer.name],
      related: { kind: "test_drive", id: drive.id, label: drive.driveNo },
    });
    refresh();
    return succeeded(`Test drive ${drive.driveNo} booked`, `${model} at ${dealer.name} — confirmation sent on WhatsApp.`);
  });
}

/** Checks the licence number the customer shows — simulated against Sarathi, the national licence register. */
export async function verifyLicence(driveId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const d = await loadDrive(driveId);
    if (!d) return gone("test drive");
    if (!ACTIVE.includes(d.status)) return failed(`A ${d.status.toLowerCase()} drive needs no licence check`);
    const licenceNo = normaliseLicence(str(fd, "licenceNo", 20) || d.licenceNo || "");
    if (!licenceNo) return failed("That driving licence number isn't valid", "State code, RTO, year and serial — e.g. MH14 2011 0062821.");
    await updateRow("test_drives", d.id, { licenceNo, licenceVerified: true });
    refresh();
    return succeeded("Licence verified", `${licenceNo.slice(0, 4)} ${licenceNo.slice(4, 8)} ${licenceNo.slice(8)} — valid for three-wheelers.`);
  });
}

export async function checkInTestDrive(driveId: string): Promise<ActionResult> {
  return saving(async () => {
    const d = await loadDrive(driveId);
    if (!d) return gone("test drive");
    if (d.status !== "Scheduled") return failed(`Already ${d.status.toLowerCase()}`);
    if (!d.licenceVerified) return failed("Verify the driving licence first", "No keys without a checked licence.");
    await updateRow("test_drives", d.id, { status: "Checked In" });
    refresh();
    return succeeded(`${d.customer} is out in the ${d.model}`);
  });
}

const INTEREST = ["Hot", "Warm", "Cold"] as const;
const SCORE_SHIFT: Record<(typeof INTEREST)[number], number> = { Hot: 15, Warm: 5, Cold: -10 };
const NEXT_ACTION: Record<(typeof INTEREST)[number], string> = { Hot: "Share a quotation", Warm: "Follow up in 3 days", Cold: "Nurture — add to a campaign" };

/** Feedback closes the drive and goes back onto the lead. */
export async function completeTestDrive(driveId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const d = await loadDrive(driveId);
    if (!d) return gone("test drive");
    if (d.status !== "Checked In") return failed(d.status === "Scheduled" ? "Check the customer in first" : `Already ${d.status.toLowerCase()}`);
    const rating = int(fd, "rating", 1, 5);
    if (rating === null) return failed("Rate the drive from 1 to 5");
    const interest = oneOf(fd, "interest", INTEREST);
    if (!interest) return failed("How keen is the customer — hot, warm or cold?");
    const comments = str(fd, "comments", 500);
    const at = new Date().toISOString();

    await updateRow("test_drives", d.id, { status: "Completed", completedAt: at, feedback: { rating, interest, comments } });

    let onLead = "";
    if (d.leadId) {
      const { data } = await readMany(["leads"] as const);
      const lead = data.leads.find((l) => l.id === d.leadId);
      if (lead) {
        const remark: LeadRemark = {
          id: runtimeId("RMK"),
          leadId: lead.id,
          author: OPERATOR.name,
          note: `Test drive ${d.driveNo} in the ${d.model}: ${rating}/5, ${interest.toLowerCase()}.${comments ? ` “${comments}”` : ""}`,
          createdAt: at,
        };
        await insertRow("lead_remarks", remark);
        const patch: Partial<Lead> = { score: Math.max(0, Math.min(100, lead.score + SCORE_SHIFT[interest])), nextAction: NEXT_ACTION[interest], updatedAt: at };
        await updateRow("leads", lead.id, patch);
        onLead = ` Lead score ${lead.score} → ${patch.score}.`;
        if (interest !== "Cold") {
          const followUp: FollowUp = {
            id: runtimeId("FUP"),
            subject: interest === "Hot" ? `Quotation after test drive ${d.driveNo}` : `Check in after test drive ${d.driveNo}`,
            relatedTo: "Lead",
            customer: d.customer,
            owner: lead.assignedTo ?? OPERATOR.name,
            channel: interest === "Hot" ? "Visit" : "Call",
            dueAt: new Date(Date.now() + (interest === "Hot" ? 1 : 3) * DAY).toISOString(),
            status: "Due",
          };
          await insertRow("follow_ups", followUp);
          onLead += ` Follow-up scheduled for ${followUp.owner}.`;
        }
      }
    }
    refresh();
    return succeeded("Test drive complete", `${rating}/5 · ${interest}.${onLead}`);
  });
}

export async function markNoShow(driveId: string): Promise<ActionResult> {
  return saving(async () => {
    const d = await loadDrive(driveId);
    if (!d) return gone("test drive");
    if (d.status !== "Scheduled") return failed(`A ${d.status.toLowerCase()} drive can't be a no-show`);
    if (new Date(d.slotAt).getTime() > Date.now()) return failed("The slot hasn't started yet");
    await updateRow("test_drives", d.id, { status: "No Show" });
    refresh();
    return succeeded(`${d.customer} didn't turn up`, "Reschedule from the drive if they call back.");
  });
}

export async function rescheduleTestDrive(driveId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const { data } = await readMany(["test_drives"] as const);
    const d = isId(driveId) ? data.test_drives.find((x) => x.id === driveId) : undefined;
    if (!d) return gone("test drive");
    if (d.status !== "Scheduled" && d.status !== "No Show") return failed(`A ${d.status.toLowerCase()} drive can't be rescheduled`);
    const slot = dateField(fd, "slotAt");
    if (!slot || new Date(slot).getTime() < Date.now()) return failed("Choose a time in the future");
    const slotAt = new Date(slot);
    const problem = slotProblem(slotAt, d.durationMin);
    if (problem) return failed(problem);
    const busy = clash(data.test_drives, d.dealer, d.model, slotAt, d.durationMin, d.id);
    if (busy) return failed(`The ${d.model} demo is out then`, `${busy.driveNo} has it.`);
    await updateRow("test_drives", d.id, { slotAt: slotAt.toISOString(), status: "Scheduled" });
    refresh();
    return succeeded(`${d.driveNo} moved`, slotAt.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }));
  });
}

export async function cancelTestDrive(driveId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const d = await loadDrive(driveId);
    if (!d) return gone("test drive");
    if (!ACTIVE.includes(d.status)) return failed(`Already ${d.status.toLowerCase()}`);
    const reason = str(fd, "reason", 200);
    if (reason.length < 3) return failed("Say why it's cancelled");
    await updateRow("test_drives", d.id, { status: "Cancelled", cancelReason: reason });
    refresh();
    return succeeded(`${d.driveNo} cancelled`, reason);
  });
}
