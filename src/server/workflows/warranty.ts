import "server-only";
import { vehiclesOnRoad } from "@/lib/fleet";
import { OPERATOR } from "@/lib/operator";
import { OPEN_CLAIM_STATUSES, adjudicate, serviceRecordsComplete, warrantyPlan } from "@/lib/warranty";
import { runtimeId } from "../ids";
import { nextNumber } from "../numbering";
import { insertRow, readMany } from "../store";
import type { WarrantyClaim } from "../types";

/**
 * Filing a warranty claim — one function, so a claim typed in on Warranty
 * Claims and one raised by closing a job card are adjudicated the same way
 * (EV-CRM's submitWarrantyClaim, shared by staff intake and the dealer portal
 * for the same reason).
 *
 * The evidence is gathered from what the platform already knows before the
 * rules run: the handover date from deliveries, the service history from
 * closed job cards, and — when the dealer did not give them — the odometer
 * and battery state of health from the vehicle's telematics unit.
 */

export interface ClaimIntake {
  dealer: string;
  vin: string;
  component: WarrantyClaim["component"];
  claimedAmount: number;
  customer: string | null;
  customerPhone: string | null;
  issue: string | null;
  odometerKm: number | null;
  measuredSohPct: number | null;
  chargerType: string | null;
  jobCardId: string | null;
  /** Where the dealer's own readings came from, when given. */
  source: "Dealer" | "Job card";
  /** The history line for the claim being raised. */
  note: string;
}

export async function fileClaim(input: ClaimIntake): Promise<WarrantyClaim> {
  const { data } = await readMany(["warranty_claims", "vehicle_units", "bookings", "deliveries", "registrations", "job_cards", "telematics", "products"] as const);
  const onRoad = vehiclesOnRoad(data).find((v) => v.unit.vin === input.vin);
  const unit = data.vehicle_units.find((u) => u.vin === input.vin);
  const device = data.telematics.find((t) => t.vin === input.vin);
  const model = unit?.model ?? device?.model ?? null;
  const product = model ? data.products.find((p) => p.model === model) : undefined;

  // The dealer's readings win; the telematics unit fills what they left out.
  const odometerKm = input.odometerKm ?? device?.odometerKm ?? null;
  const measuredSohPct = input.component === "Battery Pack" ? (input.measuredSohPct ?? device?.soh ?? null) : null;
  const fromTelematics = (input.odometerKm === null && device?.odometerKm != null) || (input.component === "Battery Pack" && input.measuredSohPct === null && device?.soh != null);

  const records = onRoad ? serviceRecordsComplete(onRoad.deliveredAt, onRoad.freeServicesDone) : null;
  const hasOpenDuplicate = data.warranty_claims.some((c) => c.vin === input.vin && c.component === input.component && OPEN_CLAIM_STATUSES.includes(c.status));
  const plan = model ? warrantyPlan(input.component, product?.warranty) : null;
  const result = adjudicate({
    plan,
    registeredAt: onRoad?.deliveredAt ?? null,
    odometerKm,
    measuredSohPct,
    chargerType: input.chargerType,
    serviceRecordsComplete: records?.complete ?? true,
    hasOpenDuplicate,
  });
  // Say how the service-record rule was judged, in figures.
  if (records) {
    const figures = `${records.done} of ${records.due} free services due were done in the network`;
    result.reasons = result.reasons.map((r) =>
      r === "Service records complete." ? `Service records complete — ${figures}.` : r.startsWith("Service records are incomplete") ? `Service records are incomplete — ${figures}.` : r
    );
  }

  const at = new Date().toISOString();
  const status: WarrantyClaim["status"] = result.decision === "Auto-approve" ? "Approved" : result.decision === "Void" ? "Rejected" : "Under Review";
  const engineNote = `Auto-adjudication: ${result.decision}.`;
  const claim: WarrantyClaim = {
    id: runtimeId("WCL"),
    claimNo: nextNumber(
      data.warranty_claims.map((c) => c.claimNo),
      "WC",
      900
    ),
    dealer: input.dealer,
    vin: input.vin,
    component: input.component,
    status,
    claimedAmount: input.claimedAmount,
    raisedAt: at,
    jobCardId: input.jobCardId,
    approvedAmount: status === "Approved" ? input.claimedAmount : null,
    recoveryRef: null,
    model,
    customer: input.customer ?? onRoad?.customer ?? null,
    customerPhone: input.customerPhone ?? onRoad?.phone ?? null,
    issue: input.issue,
    odometerKm,
    measuredSohPct,
    chargerType: input.chargerType,
    serviceRecordsComplete: records?.complete ?? null,
    evidenceSource: fromTelematics ? "Telematics" : input.source,
    coverStartedAt: onRoad?.deliveredAt ?? null,
    adjudication: { decision: result.decision, reasons: result.reasons, at },
    rejectionReason: status === "Rejected" ? result.reasons.filter((r) => /^Outside|not a valid|not on the approved|incomplete/.test(r)).join(" ") : null,
    infoRequest: null,
    partReturned: false,
    partReturnedAt: null,
    creditNoteNo: null,
    reimbursedAt: null,
    recovery: null,
    resolvedAt: status === "Rejected" ? at : null,
    history: [
      { status: "Submitted", at, by: OPERATOR.name, note: input.note },
      { status, at, by: "Rules engine", note: `${engineNote} ${result.reasons.join(" ")}` },
    ],
  };
  await insertRow("warranty_claims", claim);
  return claim;
}
