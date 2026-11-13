"use server";

import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { LOAN_LIMITS, emi } from "@/lib/finance";
import { rupees } from "@/lib/gst";
import { idvFor, quoteInsurance } from "@/lib/insurance";
import { OPERATOR } from "@/lib/operator";
import { runtimeId } from "../ids";
import { nextNumber, numericRef } from "../numbering";
import { deleteRow, insertRow, readMany, updateRow } from "../store";
import { INSURERS, LOAN_DOCUMENTS, type FinanceCase, type Financier, type InsurancePolicy, type WorkflowEvent } from "../types";
import { ACTIVE_LOAN, openDelivery } from "../workflows/bookings";
import { queueVoucher } from "../workflows/ledger";
import { sendMessage } from "../workflows/messaging";
import { gone, int, isId, num, oneOf, refresh, str, ticked, type Prev } from "./input";
import { saving } from "./outcome";

/**
 * Finance & insurance — loan cases against bookings, motor policies on each
 * chassis, the financier panel and the payouts the dealer earns.
 *
 * A loan runs Applied → Under Review (every document in) → Sanctioned (with
 * the bureau score) → Disbursed. Disbursal is what releases a booking that
 * was waiting on finance: it moves to Ready for Delivery and its delivery
 * opens.
 */

const DAY = 86_400_000;
const event = (status: string, note?: string): WorkflowEvent => ({ status, at: new Date().toISOString(), by: OPERATOR.name, ...(note ? { note } : {}) });

async function loadCase(caseId: string) {
  if (!isId(caseId)) return null;
  const { data } = await readMany(["finance_cases"] as const);
  return data.finance_cases.find((c) => c.id === caseId) ?? null;
}

export async function openLoanCase(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const { data } = await readMany(["bookings", "financiers", "finance_cases"] as const);
    const booking = data.bookings.find((b) => b.id === str(fd, "bookingId", 64));
    if (!booking) return failed("Choose the booking the loan is for");
    if (booking.status !== "Confirmed" && booking.status !== "Awaiting Finance") return failed(`A ${booking.status.toLowerCase()} booking can't take a new loan`);
    const open = data.finance_cases.find((c) => c.bookingId === booking.id && (ACTIVE_LOAN as readonly string[]).includes(c.status));
    if (open) return failed(`Loan ${open.caseNo} is already ${open.status.toLowerCase()} for this booking`);

    const financier = data.financiers.find((f) => f.id === str(fd, "financierId", 64) && f.active);
    if (!financier) return failed("Choose a financier on the panel");

    const value = booking.total;
    const downPayment = int(fd, "downPayment", 0, value);
    if (downPayment === null) return failed("Enter the down payment in whole rupees");
    const minDown = Math.ceil((value * Math.max(LOAN_LIMITS.minDownPct, financier.minDownPct)) / 100);
    if (downPayment < minDown) return failed(`${financier.name} needs at least ${Math.max(LOAN_LIMITS.minDownPct, financier.minDownPct)}% down`, `That is ${rupees(minDown)} on ${rupees(value)}.`);
    const tenure = int(fd, "tenure", LOAN_LIMITS.minTenure, Math.min(LOAN_LIMITS.maxTenure, financier.maxTenure));
    if (tenure === null) return failed(`Tenure must be ${LOAN_LIMITS.minTenure}–${Math.min(LOAN_LIMITS.maxTenure, financier.maxTenure)} months with ${financier.name}`);
    const rate = num(fd, "rate", financier.rateFrom, LOAN_LIMITS.maxRate);
    if (rate === null) return failed(`${financier.name}'s rate starts at ${financier.rateFrom}%`);

    const loanAmount = value - downPayment;
    if (loanAmount <= 0) return failed("Nothing left to finance", "The down payment covers the whole booking.");
    const loan: FinanceCase = {
      id: runtimeId("LN"),
      caseNo: nextNumber(data.finance_cases.map((c) => c.caseNo), "LN", 8000),
      bookingId: booking.id,
      bookingNo: booking.bookingNo,
      customer: booking.customer,
      dealer: booking.dealer,
      model: booking.model,
      quantity: Math.max(1, booking.quantity ?? 1),
      financierId: financier.id,
      financier: financier.name,
      vehicleValue: value,
      downPayment,
      loanAmount,
      ratePct: Math.round(rate * 100) / 100,
      tenureMonths: tenure,
      emi: emi(loanAmount, rate, tenure),
      processingFee: Math.round((loanAmount * financier.processingFeePct) / 100),
      // The booking form exists already — it is the booking.
      documents: LOAN_DOCUMENTS.map((name) => ({ name, received: name === "Booking Form" })),
      cibil: null,
      status: "Applied",
      sanctionRef: null,
      utr: null,
      appliedAt: new Date().toISOString(),
      sanctionedAt: null,
      disbursedAt: null,
      payout: { amount: Math.round((loanAmount * financier.payoutPct) / 100), status: "Pending", receivedAt: null, reference: null },
      history: [event("Applied", `${rupees(loanAmount)} over ${tenure} months at ${rate}% with ${financier.name}`)],
    };
    await insertRow("finance_cases", loan);
    if (booking.status === "Confirmed") await updateRow("bookings", booking.id, { status: "Awaiting Finance" });
    refresh();
    return succeeded(`Loan case ${loan.caseNo} opened`, `EMI ${rupees(loan.emi)} × ${tenure}. Collect the documents next.`);
  });
}

export async function updateLoanDocuments(caseId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const c = await loadCase(caseId);
    if (!c) return gone("loan case");
    if (c.status !== "Applied" && c.status !== "Under Review") return failed(`A ${c.status.toLowerCase()} case's documents are closed`);
    const received = ticked(fd, "doc");
    const documents = c.documents.map((d) => ({ ...d, received: received.has(d.name) }));
    await updateRow("finance_cases", c.id, { documents });
    refresh();
    const missing = documents.filter((d) => !d.received).length;
    return succeeded("Documents updated", missing ? `${missing} still to collect.` : "Everything is in — submit it to the lender.");
  });
}

export async function submitLoan(caseId: string): Promise<ActionResult> {
  return saving(async () => {
    const c = await loadCase(caseId);
    if (!c) return gone("loan case");
    if (c.status !== "Applied") return failed(`Already ${c.status.toLowerCase()}`);
    const missing = c.documents.filter((d) => !d.received).map((d) => d.name);
    if (missing.length) return failed("Documents are missing", missing.join(", "));
    await updateRow("finance_cases", c.id, { status: "Under Review", history: [...c.history, event("Under Review", `Submitted to ${c.financier}`)] });
    refresh();
    return succeeded(`Submitted to ${c.financier}`, "Lenders on the panel sanction in 48–72 hours.");
  });
}

export async function decideLoan(caseId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const c = await loadCase(caseId);
    if (!c) return gone("loan case");
    if (c.status !== "Under Review") return failed("Only a case under review can be decided");
    const decision = oneOf(fd, "decision", ["Sanctioned", "Rejected"] as const);
    if (!decision) return failed("Sanction or reject");
    const cibil = int(fd, "cibil", 300, 900);
    if (cibil === null) return failed("Enter the bureau score the lender pulled (300–900)");
    const note = str(fd, "note", 300);
    if (decision === "Rejected" && note.length < 3) return failed("Record the lender's reason");

    const at = new Date().toISOString();
    if (decision === "Rejected") {
      await updateRow("finance_cases", c.id, { status: "Rejected", cibil, history: [...c.history, event("Rejected", `Bureau score ${cibil} — ${note}`)] });
      refresh();
      return succeeded(`${c.financier} declined ${c.caseNo}`, "Open a case with another lender on the panel, or take the balance as cash.");
    }

    const sanctionRef = `SAN/${c.financier.replace(/[^A-Z]/g, "").slice(0, 4) || "NBFC"}/${numericRef(6)}`;
    await updateRow("finance_cases", c.id, {
      status: "Sanctioned",
      cibil,
      sanctionRef,
      sanctionedAt: at,
      history: [...c.history, event("Sanctioned", `${sanctionRef} · bureau score ${cibil}${note ? ` · ${note}` : ""}`)],
    });
    const { data } = await readMany(["bookings"] as const);
    const booking = data.bookings.find((b) => b.id === c.bookingId);
    if (booking?.phone) {
      await sendMessage({
        channel: "WhatsApp",
        template: "loan_sanctioned",
        to: booking.phone,
        customer: c.customer,
        vars: [c.customer, rupees(c.loanAmount), c.financier, rupees(c.emi)],
        related: { kind: "finance_case", id: c.id, label: c.caseNo },
      });
    }
    refresh();
    return succeeded(`${c.caseNo} sanctioned`, `${rupees(c.loanAmount)} by ${c.financier} — disburse once the delivery order is in.`);
  });
}

/** Disbursal: the lender pays the dealer, the booking is released for delivery and the dealer's payout accrues. */
export async function disburseLoan(caseId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const c = await loadCase(caseId);
    if (!c) return gone("loan case");
    if (c.status !== "Sanctioned") return failed("Only a sanctioned loan can be disbursed");
    const utr = str(fd, "utr", 30).toUpperCase().replace(/\s/g, "");
    if (!/^[A-Z0-9]{12,22}$/.test(utr)) return failed("Enter the UTR of the lender's transfer", "12–22 letters and digits, from the bank advice.");

    const at = new Date().toISOString();
    await updateRow("finance_cases", c.id, {
      status: "Disbursed",
      utr,
      disbursedAt: at,
      payout: { ...c.payout, status: "Accrued" },
      history: [...c.history, event("Disbursed", `UTR ${utr}`)],
    });

    const { data } = await readMany(["bookings"] as const);
    const booking = data.bookings.find((b) => b.id === c.bookingId);
    let released = "";
    if (booking && booking.status === "Awaiting Finance") {
      await updateRow("bookings", booking.id, { status: "Ready for Delivery" });
      const delivery = await openDelivery({ ...booking, status: "Ready for Delivery" });
      released = ` Booking ${booking.bookingNo} is ready — delivery ${delivery.deliveryNo} is open.`;
    }
    refresh();
    return succeeded(`${c.caseNo} disbursed`, `${rupees(c.loanAmount)} received; payout of ${rupees(c.payout.amount)} accrued.${released}`);
  });
}

export async function withdrawLoan(caseId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const c = await loadCase(caseId);
    if (!c) return gone("loan case");
    if (c.status !== "Applied" && c.status !== "Under Review" && c.status !== "Sanctioned") return failed(`A ${c.status.toLowerCase()} case can't be withdrawn`);
    const reason = str(fd, "reason", 300);
    if (reason.length < 3) return failed("Say why the case is withdrawn");
    await updateRow("finance_cases", c.id, { status: "Withdrawn", history: [...c.history, event("Withdrawn", reason)] });
    refresh();
    return succeeded(`${c.caseNo} withdrawn`, reason);
  });
}

export async function receivePayout(caseId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const c = await loadCase(caseId);
    if (!c) return gone("loan case");
    if (c.payout.status !== "Accrued") return failed(c.payout.status === "Received" ? "Already received" : "The payout accrues when the loan is disbursed");
    const reference = str(fd, "reference", 40) || `PAYOUT-${numericRef(8)}`;
    await updateRow("finance_cases", c.id, { payout: { ...c.payout, status: "Received", receivedAt: new Date().toISOString(), reference } });
    await queueVoucher({
      voucherType: "Receipt",
      source: "Finance Payout",
      sourceId: c.id,
      reference: `${c.caseNo} payout`,
      party: c.financier,
      amount: c.payout.amount,
      ledgers: ["bank", "finance_payout_income"],
    });
    refresh();
    return succeeded(`Payout of ${rupees(c.payout.amount)} received`, `${c.financier} · ${reference}`);
  });
}

// ---------------------------------------------------------------------------
// Insurance — one policy per chassis, so vehicles must be allocated first.
// ---------------------------------------------------------------------------

export async function issuePolicies(bookingId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(bookingId)) return gone("booking");
    const insurer = oneOf(fd, "insurer", INSURERS);
    if (!insurer) return failed("Choose the insurer");
    const cover = oneOf(fd, "cover", ["Comprehensive", "Third Party Only"] as const) ?? "Comprehensive";

    const { data } = await readMany(["bookings", "vehicle_units", "insurance_policies", "products"] as const);
    const booking = data.bookings.find((b) => b.id === bookingId);
    if (!booking) return gone("booking");
    if (booking.status === "Cancelled") return failed("This booking was cancelled");

    const insured = new Set(data.insurance_policies.filter((p) => p.status === "Issued" && p.vehicleUnitId).map((p) => p.vehicleUnitId));
    const units = data.vehicle_units.filter((u) => u.bookingId === booking.id && !insured.has(u.id));
    if (!units.length) {
      const allocated = data.vehicle_units.some((u) => u.bookingId === booking.id);
      return failed(allocated ? "Every allocated vehicle is already insured" : "No vehicles allocated yet", allocated ? undefined : "A policy needs the chassis number — allocate the vehicles in Vehicle Delivery first.");
    }

    const product = data.products.find((p) => p.model === booking.model);
    const now = new Date();
    for (const unit of units) {
      const exShowroom = product?.variants.find((v) => v.variant === unit.variant)?.exShowroom ?? unit.price;
      const quote = quoteInsurance(idvFor(exShowroom), product?.rtoClass ?? "e-Rickshaw", cover).find((q) => q.insurer === insurer)!;
      const policy: InsurancePolicy = {
        id: runtimeId("POL"),
        policyNo: `${insurer.replace(/[^A-Z]/g, "").slice(0, 4)}/CV/${String(now.getFullYear()).slice(-2)}/${numericRef(7)}`,
        bookingId: booking.id,
        vehicleUnitId: unit.id,
        vin: unit.vin,
        customer: booking.customer,
        dealer: booking.dealer,
        model: booking.model,
        insurer,
        cover,
        idv: quote.idv,
        odPremium: quote.odPremium,
        tpPremium: quote.tpPremium,
        gst: quote.gst,
        premium: quote.premium,
        commissionPct: quote.commissionPct,
        commission: quote.commission,
        commissionStatus: "Accrued",
        startsOn: now.toISOString(),
        endsOn: new Date(now.getTime() + 365 * DAY - DAY).toISOString(),
        status: "Issued",
        issuedAt: now.toISOString(),
      };
      await insertRow("insurance_policies", policy);
    }
    refresh();
    return succeeded(`${units.length} polic${units.length === 1 ? "y" : "ies"} issued with ${insurer}`, `${cover} cover for ${booking.customer}.`);
  });
}

export async function cancelPolicy(policyId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(policyId)) return gone("policy");
    const reason = str(fd, "reason", 200);
    if (reason.length < 3) return failed("Say why the policy is cancelled");
    const { data } = await readMany(["insurance_policies", "vehicle_units"] as const);
    const policy = data.insurance_policies.find((p) => p.id === policyId);
    if (!policy) return gone("policy");
    if (policy.status !== "Issued") return failed("Already cancelled");
    const unit = data.vehicle_units.find((u) => u.id === policy.vehicleUnitId);
    if (unit?.status === "Delivered") return failed("The vehicle is on the road", "A delivered vehicle must stay insured — endorse the policy with the insurer instead.");
    await updateRow("insurance_policies", policy.id, { status: "Cancelled" });
    refresh();
    return succeeded(`Policy ${policy.policyNo} cancelled`, reason);
  });
}

export async function receiveCommission(policyId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(policyId)) return gone("policy");
    const { data } = await readMany(["insurance_policies"] as const);
    const policy = data.insurance_policies.find((p) => p.id === policyId);
    if (!policy) return gone("policy");
    if (policy.commissionStatus === "Received") return failed("Already received");
    await updateRow("insurance_policies", policy.id, { commissionStatus: "Received" });
    await queueVoucher({
      voucherType: "Receipt",
      source: "Insurance Commission",
      sourceId: policy.id,
      reference: `${policy.policyNo} commission`,
      party: policy.insurer,
      amount: policy.commission,
      ledgers: ["bank", "insurance_commission_income"],
    });
    refresh();
    return succeeded(`Commission of ${rupees(policy.commission)} received`, policy.insurer);
  });
}

// ---------------------------------------------------------------------------
// Financier panel
// ---------------------------------------------------------------------------

/** Put a bank or an NBFC on the panel. */
export async function createFinancier(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const name = str(fd, "name", 80);
    if (!name) return failed("Name the financier");
    const kind = oneOf(fd, "kind", ["NBFC", "Bank"] as const);
    if (!kind) return failed("Bank or NBFC?");
    const rateFrom = num(fd, "rateFrom", LOAN_LIMITS.minRate - 2, LOAN_LIMITS.maxRate);
    const maxTenure = int(fd, "maxTenure", LOAN_LIMITS.minTenure, LOAN_LIMITS.maxTenure);
    const minDownPct = num(fd, "minDownPct", 0, 90);
    const processingFeePct = num(fd, "processingFeePct", 0, 5);
    const payoutPct = num(fd, "payoutPct", 0, 5);
    if (rateFrom === null || maxTenure === null || minDownPct === null || processingFeePct === null || payoutPct === null) {
      return failed("Check the figures", `Rate ${LOAN_LIMITS.minRate - 2}–${LOAN_LIMITS.maxRate}%, tenure ${LOAN_LIMITS.minTenure}–${LOAN_LIMITS.maxTenure} months, fees and payout up to 5%.`);
    }

    const { data } = await readMany(["financiers"] as const);
    if (data.financiers.some((f) => f.name.toLowerCase() === name.toLowerCase())) return failed(`${name} is already on the panel`);

    const financier: Financier = { id: runtimeId("FIN"), name, kind, rateFrom, maxTenure, minDownPct, processingFeePct, payoutPct, active: true };
    await insertRow("financiers", financier);
    refresh();
    return succeeded(`${name} added to the panel`, `From ${rateFrom}% · up to ${maxTenure} months`);
  });
}

/** One that has never carried a case can go; otherwise take it off the panel instead. */
export async function deleteFinancier(financierId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(financierId)) return gone("financier");
    const { data } = await readMany(["financiers", "finance_cases"] as const);
    const financier = data.financiers.find((f) => f.id === financierId);
    if (!financier) return gone("financier");
    const cases = data.finance_cases.filter((c) => c.financierId === financierId).length;
    if (cases) return failed(`${financier.name} has ${cases} loan case${cases === 1 ? "" : "s"}`, "Untick Active to take it off the panel — its cases keep their terms.");
    await deleteRow("financiers", financierId);
    refresh();
    return succeeded(`${financier.name} removed from the panel`);
  });
}

export async function updateFinancier(financierId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(financierId)) return gone("financier");
    const rateFrom = num(fd, "rateFrom", LOAN_LIMITS.minRate - 2, LOAN_LIMITS.maxRate);
    const maxTenure = int(fd, "maxTenure", LOAN_LIMITS.minTenure, LOAN_LIMITS.maxTenure);
    const minDownPct = num(fd, "minDownPct", 0, 90);
    const processingFeePct = num(fd, "processingFeePct", 0, 5);
    const payoutPct = num(fd, "payoutPct", 0, 5);
    if (rateFrom === null || maxTenure === null || minDownPct === null || processingFeePct === null || payoutPct === null) {
      return failed("Check the figures", `Rate ${LOAN_LIMITS.minRate - 2}–${LOAN_LIMITS.maxRate}%, tenure ${LOAN_LIMITS.minTenure}–${LOAN_LIMITS.maxTenure} months, fees and payout up to 5%.`);
    }
    const updated = await updateRow("financiers", financierId, { rateFrom, maxTenure, minDownPct, processingFeePct, payoutPct, active: fd.get("active") === "on" });
    if (!updated) return gone("financier");
    refresh();
    return succeeded(`${updated.name} updated`, updated.active ? `From ${rateFrom}% · up to ${maxTenure} months` : "Off the panel — no new cases.");
  });
}
