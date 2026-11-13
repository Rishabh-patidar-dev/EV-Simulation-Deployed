"use server";

import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { rupees } from "@/lib/gst";
import { OPERATOR } from "@/lib/operator";
import { CLAIM_COMPONENTS, OPEN_CLAIM_STATUSES, PART_RETURN_REQUIRED, adjudicate, warrantyPlan } from "@/lib/warranty";
import { numberSeries } from "../numbering";
import { readMany, updateRow } from "../store";
import type { WorkflowEvent } from "../types";
import { ensureLedger, queueVoucher } from "../workflows/ledger";
import { fileClaim } from "../workflows/warranty";
import { gone, int, isId, oneOf, phoneField, refresh, str, type Prev } from "./input";
import { saving } from "./outcome";

/**
 * Warranty claims, end to end — EV-CRM's warranty module:
 *
 *   intake → auto-adjudication → (review / info request) → approval
 *   → repair, with the failed part returned → the dealer reimbursed by credit
 *   note → the cost recovered from the component's supplier → closed.
 *
 * The rules engine decides clean claims on arrival; people see only the
 * exceptions. Every step is written to the claim's history with who did it.
 */

const event = (status: string, note?: string): WorkflowEvent => ({ status, at: new Date().toISOString(), by: OPERATOR.name, ...(note ? { note } : {}) });

async function loadClaim(claimId: string) {
  if (!isId(claimId)) return null;
  const { data } = await readMany(["warranty_claims"] as const);
  return data.warranty_claims.find((c) => c.id === claimId) ?? null;
}

/** Optional whole number in range: null when blank, undefined when given but invalid. */
function optionalInt(fd: FormData, key: string, min: number, max: number): number | null | undefined {
  if (str(fd, key, 20) === "") return null;
  return int(fd, key, min, max) ?? undefined;
}

export async function raiseClaim(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const { data } = await readMany(["dealers"] as const);
    const dealer = data.dealers.find((d) => d.name === str(fd, "dealer"));
    if (!dealer) return failed("Choose the dealer raising the claim");
    const vin = str(fd, "vin", 20).toUpperCase();
    if (!/^[A-Z0-9]{11,17}$/.test(vin)) return failed("Enter the chassis number");
    const component = oneOf(fd, "component", CLAIM_COMPONENTS);
    if (!component) return failed("Choose the failed component");
    const amount = int(fd, "claimedAmount", 100, 1_000_000);
    if (amount === null) return failed("Claimed amount must be ₹100–₹10,00,000");
    const issue = str(fd, "issue", 500);
    if (issue.length < 5) return failed("Describe the failure", "The symptom in the customer's words — the reviewer reads it first.");

    const odometerKm = optionalInt(fd, "odometerKm", 0, 1_000_000);
    if (odometerKm === undefined) return failed("The odometer reading must be 0–10,00,000 km");
    const measuredSohPct = optionalInt(fd, "measuredSohPct", 0, 100);
    if (measuredSohPct === undefined) return failed("State of health is a percentage, 0–100");
    const phoneRaw = str(fd, "customerPhone", 20);
    const customerPhone = phoneRaw ? phoneField(fd, "customerPhone") : null;
    if (phoneRaw && !customerPhone) return failed("That phone number is not valid");

    const claim = await fileClaim({
      dealer: dealer.name,
      vin,
      component,
      claimedAmount: amount,
      customer: str(fd, "customer", 80) || null,
      customerPhone,
      issue,
      odometerKm,
      measuredSohPct,
      chargerType: str(fd, "chargerType", 60) || null,
      jobCardId: null,
      source: "Dealer",
      note: `Raised by ${dealer.name}`,
    });
    refresh();
    const verdict =
      claim.status === "Approved"
        ? `Auto-approved — ${rupees(amount)} to ${dealer.name} once repaired.`
        : claim.status === "Rejected"
          ? `Voided by the rules: ${claim.rejectionReason}`
          : `Needs review — ${claim.adjudication?.reasons.find((r) => /^No |possible duplicate|cannot/.test(r)) ?? "a reviewer decides"}`;
    return succeeded(`Claim ${claim.claimNo} raised`, verdict);
  });
}

export async function reviewClaim(claimId: string): Promise<ActionResult> {
  return saving(async () => {
    const c = await loadClaim(claimId);
    if (!c) return gone("claim");
    if (c.status !== "Submitted") return failed(`Already ${c.status.toLowerCase()}`);
    await updateRow("warranty_claims", c.id, { status: "Under Review", history: [...(c.history ?? []), event("Under Review")] });
    refresh();
    return succeeded(`${c.claimNo} under review`);
  });
}

/** Asks the dealer for what the rules could not find — a reading, a photo, the charger. */
export async function requestInfo(claimId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const c = await loadClaim(claimId);
    if (!c) return gone("claim");
    if (c.status !== "Submitted" && c.status !== "Under Review") return failed(`A ${c.status.toLowerCase()} claim can't be sent back`);
    const request = str(fd, "request", 300);
    if (request.length < 5) return failed("Say what the dealer needs to send");
    await updateRow("warranty_claims", c.id, { status: "Info Requested", infoRequest: request, history: [...(c.history ?? []), event("Info Requested", request)] });
    refresh();
    return succeeded(`Asked ${c.dealer} for more`, request);
  });
}

/**
 * The dealer's answer: the missing evidence, then the rules run again. The
 * result goes back to the reviewer as a recommendation — once a person has
 * looked at a claim, a person decides it.
 */
export async function supplyInfo(claimId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(claimId)) return gone("claim");
    const { data } = await readMany(["warranty_claims", "products"] as const);
    const c = data.warranty_claims.find((x) => x.id === claimId);
    if (!c) return gone("claim");
    if (c.status !== "Info Requested") return failed("Nothing was asked for on this claim");

    const odometerKm = optionalInt(fd, "odometerKm", 0, 1_000_000);
    const measuredSohPct = optionalInt(fd, "measuredSohPct", 0, 100);
    if (odometerKm === undefined || measuredSohPct === undefined) return failed("Check the readings", "Odometer 0–10,00,000 km; SoH 0–100%.");
    const chargerType = str(fd, "chargerType", 60) || null;
    const reply = str(fd, "reply", 500);
    if (!reply && odometerKm === null && measuredSohPct === null && !chargerType) return failed("Give at least one answer");

    const next = {
      odometerKm: odometerKm ?? c.odometerKm ?? null,
      measuredSohPct: c.component === "Battery Pack" ? (measuredSohPct ?? c.measuredSohPct ?? null) : null,
      chargerType: chargerType ?? c.chargerType ?? null,
    };
    const product = data.products.find((p) => p.model === c.model);
    const result = adjudicate({
      plan: c.model ? warrantyPlan(c.component, product?.warranty) : null,
      registeredAt: c.coverStartedAt ?? null,
      ...next,
      serviceRecordsComplete: c.serviceRecordsComplete ?? true,
      hasOpenDuplicate: data.warranty_claims.some((x) => x.id !== c.id && x.vin === c.vin && x.component === c.component && OPEN_CLAIM_STATUSES.includes(x.status)),
    });
    const at = new Date().toISOString();
    await updateRow("warranty_claims", c.id, {
      ...next,
      evidenceSource: "Dealer",
      status: "Under Review",
      infoRequest: null,
      adjudication: { decision: result.decision, reasons: result.reasons, at },
      history: [...(c.history ?? []), event("Information received", reply || undefined), { status: "Under Review", at, by: "Rules engine", note: `Re-run: ${result.decision}. ${result.reasons.join(" ")}` }],
    });
    refresh();
    return succeeded(`${c.claimNo} back under review`, `The rules now say: ${result.decision.toLowerCase()}.`);
  });
}

export async function decideClaim(claimId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const c = await loadClaim(claimId);
    if (!c) return gone("claim");
    if (c.status !== "Under Review" && c.status !== "Submitted" && c.status !== "Info Requested") return failed(`Already ${c.status.toLowerCase()}`);
    const decision = oneOf(fd, "decision", ["Approved", "Rejected"] as const);
    if (!decision) return failed("Approve or reject");
    const note = str(fd, "note", 300);
    if (decision === "Rejected" && note.length < 3) return failed("Give the reason — the dealer sees it");
    const approvedAmount = decision === "Approved" ? (int(fd, "approvedAmount", 1, c.claimedAmount) ?? c.claimedAmount) : 0;
    const at = new Date().toISOString();
    await updateRow("warranty_claims", c.id, {
      status: decision,
      approvedAmount,
      infoRequest: null,
      rejectionReason: decision === "Rejected" ? note : null,
      resolvedAt: decision === "Rejected" ? at : null,
      history: [
        ...(c.history ?? []),
        event(decision, decision === "Approved" ? `${rupees(approvedAmount)} of ${rupees(c.claimedAmount)}${note ? ` · ${note}` : ""}` : note),
      ],
    });
    refresh();
    return succeeded(`${c.claimNo} ${decision.toLowerCase()}`, decision === "Approved" ? `${rupees(approvedAmount)} — repair it, then reimburse ${c.dealer}.` : note);
  });
}

/** A claim the rules voided, put in front of a person — a goodwill case, or evidence the rules did not have. */
export async function reopenClaim(claimId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const c = await loadClaim(claimId);
    if (!c) return gone("claim");
    if (c.status !== "Rejected") return failed("Only a rejected claim can be reopened");
    const note = str(fd, "note", 300);
    if (note.length < 5) return failed("Say why it is being looked at again");
    await updateRow("warranty_claims", c.id, { status: "Under Review", rejectionReason: null, resolvedAt: null, history: [...(c.history ?? []), event("Reopened", note)] });
    refresh();
    return succeeded(`${c.claimNo} reopened for review`, note);
  });
}

export async function startRepair(claimId: string): Promise<ActionResult> {
  return saving(async () => {
    const c = await loadClaim(claimId);
    if (!c) return gone("claim");
    if (c.status !== "Approved") return failed("Only an approved claim goes to repair");
    await updateRow("warranty_claims", c.id, { status: "In Repair", history: [...(c.history ?? []), event("In Repair", `${c.component} replaced at ${c.dealer}`)] });
    refresh();
    return succeeded(`${c.claimNo} in repair`, PART_RETURN_REQUIRED.includes(c.component) ? "Send the failed part back — reimbursement waits for it." : undefined);
  });
}

export async function receivePart(claimId: string): Promise<ActionResult> {
  return saving(async () => {
    const c = await loadClaim(claimId);
    if (!c) return gone("claim");
    if (c.status !== "In Repair") return failed("The part comes back while the claim is in repair");
    if (c.partReturned) return failed("Already received");
    await updateRow("warranty_claims", c.id, { partReturned: true, partReturnedAt: new Date().toISOString(), history: [...(c.history ?? []), event("Part returned", `Failed ${c.component.toLowerCase()} received from ${c.dealer}`)] });
    refresh();
    return succeeded(`Failed ${c.component.toLowerCase()} received`, "The dealer can be reimbursed now.");
  });
}

/** Credits the dealer for the approved amount — a credit note, posted to the books. */
export async function reimburseDealer(claimId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(claimId)) return gone("claim");
    const { data } = await readMany(["warranty_claims"] as const);
    const c = data.warranty_claims.find((x) => x.id === claimId);
    if (!c) return gone("claim");
    if (c.status !== "In Repair") return failed("Reimburse once the repair is done");
    if (PART_RETURN_REQUIRED.includes(c.component) && !c.partReturned) return failed(`The failed ${c.component.toLowerCase()} has not come back`, "The supplier needs it for recovery — receive it first.");
    const amount = c.approvedAmount ?? c.claimedAmount;
    const creditNoteNo = numberSeries(
      data.warranty_claims.map((x) => x.creditNoteNo ?? ""),
      "WCN",
      400
    )();

    await ensureLedger({ key: "warranty_expense", label: "Warranty expense", group: "Direct Expenses" });
    const voucher = await queueVoucher({
      voucherType: "Credit Note",
      source: "Warranty Claim",
      sourceId: c.id,
      reference: `${creditNoteNo} · ${c.claimNo}`,
      party: c.dealer,
      amount,
      ledgers: ["warranty_expense", "debtors_dealers"],
    });
    const at = new Date().toISOString();
    await updateRow("warranty_claims", c.id, { status: "Reimbursed", creditNoteNo, reimbursedAt: at, history: [...(c.history ?? []), event("Reimbursed", `Credit note ${creditNoteNo} for ${rupees(amount)}`)] });
    refresh();
    return succeeded(
      `${c.dealer} credited ${rupees(amount)}`,
      `Credit note ${creditNoteNo} — voucher ${voucher.status === "Synced" ? "posted" : voucher.status === "Failed" ? `refused (${voucher.lastError})` : "queued"}. Recover it from the supplier next.`
    );
  });
}

export async function openRecovery(claimId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const c = await loadClaim(claimId);
    if (!c) return gone("claim");
    if (c.status !== "Reimbursed") return failed("Recovery opens once the dealer has been reimbursed");
    const supplier = str(fd, "supplier", 100);
    if (supplier.length < 2) return failed("Name the supplier of the failed component");
    const limit = c.approvedAmount ?? c.claimedAmount;
    const amount = int(fd, "amount", 1, limit);
    if (amount === null) return failed(`The amount to recover must be ₹1–${rupees(limit).slice(1)}`);
    const notes = str(fd, "notes", 300) || null;
    await updateRow("warranty_claims", c.id, {
      status: "Recovery",
      recovery: { supplier, amount, status: "Open", debitNote: null, notes, openedAt: new Date().toISOString(), closedAt: null },
      history: [...(c.history ?? []), event("Recovery", `${rupees(amount)} claimed from ${supplier}${notes ? ` · ${notes}` : ""}`)],
    });
    refresh();
    return succeeded(`Recovery opened against ${supplier}`, rupees(amount));
  });
}

export async function closeRecovery(claimId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const c = await loadClaim(claimId);
    if (!c) return gone("claim");
    if (c.status !== "Recovery" || !c.recovery) return failed("There is no open recovery on this claim");
    const outcome = oneOf(fd, "outcome", ["Recovered", "Written Off"] as const);
    if (!outcome) return failed("Recovered or written off?");
    const ref = str(fd, "debitNote", 40);
    if (outcome === "Recovered" && ref.length < 3) return failed("Enter the supplier's debit note reference");
    const note = str(fd, "note", 300);
    if (outcome === "Written Off" && note.length < 3) return failed("Say why it is being written off");
    const at = new Date().toISOString();
    await updateRow("warranty_claims", c.id, {
      status: "Closed",
      recoveryRef: outcome === "Recovered" ? ref : null,
      recovery: { ...c.recovery, status: outcome, debitNote: outcome === "Recovered" ? ref : null, closedAt: at, notes: note || c.recovery.notes },
      resolvedAt: at,
      history: [...(c.history ?? []), event("Closed", outcome === "Recovered" ? `${rupees(c.recovery.amount)} recovered from ${c.recovery.supplier} · debit note ${ref}` : `Written off — ${note}`)],
    });
    refresh();
    return succeeded(`${c.claimNo} closed`, outcome === "Recovered" ? `${rupees(c.recovery.amount)} back from ${c.recovery.supplier}.` : `Written off — the OEM bears ${rupees(c.recovery.amount)}.`);
  });
}

