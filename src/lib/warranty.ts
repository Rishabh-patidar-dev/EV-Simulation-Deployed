import { FREE_SERVICES } from "@/lib/service";
import type { WarrantyClaim } from "@/server/types";

/**
 * Warranty policy and the adjudication rules, shared by the screens and the
 * actions.
 *
 * The rules engine is EV-CRM's warrantyAdjudication.service.ts ported line
 * for line (DMS-and-Warranty-Research.pdf, Appendix B):
 *
 *   registration date + term ≥ today            → within time
 *   odometer ≤ term km                           → within distance
 *   measured SoH < plan's SoH floor              → capacity claim valid
 *   charger on the plan's approved list          → not void
 *   service records complete                     → not void
 *   no other open claim on the same component    → not a duplicate
 *
 * Clean claims flow straight through; a broken hard rule voids the claim; a
 * missing piece of evidence or a possible duplicate puts it on a person's
 * desk. Every check writes a plain-English reason, so the decision is
 * evidenced rather than argued.
 *
 * Luxus Green publishes a vehicle warranty per model (the price list's
 * "Warranty" column — 3 years / 80,000 km on the LX Spark). The split by
 * component, the SoH floor and the charger list are the simulation's own
 * policy, as labelled on screen.
 */

export const CLAIM_COMPONENTS = ["Battery Pack", "Motor", "Controller", "Charger", "Harness"] as const satisfies readonly WarrantyClaim["component"][];

export interface WarrantyPlan {
  termMonths: number;
  termKm: number | null;
  /** A battery is replaced when its state of health falls below this. */
  sohFloorPct: number | null;
  approvedChargers: readonly string[];
}

export const APPROVED_CHARGERS = ["Luxus Green 48V 15A", "Luxus Green 60V 20A", "Luxus Green Fast Charger"] as const;

/** The policy used when a model's own warranty line does not say otherwise. Simulation policy. */
const BASE_POLICY: Record<WarrantyClaim["component"], WarrantyPlan> = {
  "Battery Pack": { termMonths: 36, termKm: 80_000, sohFloorPct: 70, approvedChargers: APPROVED_CHARGERS },
  Motor: { termMonths: 36, termKm: 80_000, sohFloorPct: null, approvedChargers: [] },
  Controller: { termMonths: 24, termKm: 50_000, sohFloorPct: null, approvedChargers: [] },
  Charger: { termMonths: 12, termKm: null, sohFloorPct: null, approvedChargers: [] },
  Harness: { termMonths: 12, termKm: 30_000, sohFloorPct: null, approvedChargers: [] },
};

/** "3 years / 80,000 km", "36 months", "2 yrs / 40000 km" → months and km, when the text says them. */
export function parseWarranty(text: string | null | undefined): { months: number | null; km: number | null } {
  if (!text) return { months: null, km: null };
  const years = /(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/i.exec(text);
  const months = /(\d+)\s*months?/i.exec(text);
  const km = /([\d,]+)\s*km/i.exec(text);
  return {
    months: years ? Math.round(Number(years[1]) * 12) : months ? Number(months[1]) : null,
    km: km ? Number(km[1].replace(/,/g, "")) : null,
  };
}

/**
 * The plan for one component on one model. The battery and motor carry the
 * model's published vehicle warranty; the rest keep the base policy.
 */
export function warrantyPlan(component: WarrantyClaim["component"], modelWarranty?: string | null): WarrantyPlan {
  const base = BASE_POLICY[component];
  if (component !== "Battery Pack" && component !== "Motor") return base;
  const published = parseWarranty(modelWarranty);
  return { ...base, termMonths: published.months ?? base.termMonths, termKm: published.km ?? base.termKm };
}

const MS_PER_MONTH = 30.44 * 86_400_000;

export function coverageEnds(registeredAt: string, plan: WarrantyPlan): string {
  const end = new Date(registeredAt);
  end.setMonth(end.getMonth() + plan.termMonths);
  return end.toISOString();
}

/**
 * Whether the free services due by now were all done in the network — the
 * "service records complete" rule, read off closed job cards instead of
 * taken on the dealer's word.
 */
export function serviceRecordsComplete(deliveredAt: string, freeServicesDone: number, now = Date.now()): { complete: boolean; due: number; done: number } {
  const days = (now - new Date(deliveredAt).getTime()) / 86_400_000;
  // A service is only missed once its window (plus a month's grace) has passed.
  const due = FREE_SERVICES.filter((s) => days > s.days + 30).length;
  return { complete: freeServicesDone >= due, due, done: freeServicesDone };
}

export type AdjudicationDecision = "Auto-approve" | "Needs review" | "Void";

export interface AdjudicationInput {
  plan: WarrantyPlan | null;
  /** When cover started — the handover date. */
  registeredAt: string | null;
  odometerKm: number | null;
  measuredSohPct: number | null;
  chargerType: string | null;
  serviceRecordsComplete: boolean;
  hasOpenDuplicate: boolean;
}

export function adjudicate(input: AdjudicationInput, now = Date.now()): { decision: AdjudicationDecision; reasons: string[] } {
  const reasons: string[] = [];
  let voided = false;
  let review = false;

  if (!input.plan) return { decision: "Needs review", reasons: ["No warranty plan on file for this model and component — routed for manual review."] };
  const plan = input.plan;

  if (!input.registeredAt) {
    review = true;
    reasons.push("No handover date on file for this chassis — the time term cannot be checked.");
  } else {
    const months = (now - new Date(input.registeredAt).getTime()) / MS_PER_MONTH;
    if (months > plan.termMonths) {
      voided = true;
      reasons.push(`Outside the time term: ${Math.floor(months)} months since handover against ${plan.termMonths} months of cover.`);
    } else {
      reasons.push(`Within the time term: ${Math.floor(months)} of ${plan.termMonths} months used.`);
    }
  }

  if (plan.termKm !== null) {
    if (input.odometerKm === null) {
      review = true;
      reasons.push("No odometer reading — the distance term cannot be checked.");
    } else if (input.odometerKm > plan.termKm) {
      voided = true;
      reasons.push(`Outside the distance term: ${input.odometerKm.toLocaleString("en-IN")} km against ${plan.termKm.toLocaleString("en-IN")} km of cover.`);
    } else {
      reasons.push(`Within the distance term: ${input.odometerKm.toLocaleString("en-IN")} of ${plan.termKm.toLocaleString("en-IN")} km.`);
    }
  }

  if (plan.sohFloorPct !== null) {
    if (input.measuredSohPct === null) {
      review = true;
      reasons.push(`A battery claim (SoH floor ${plan.sohFloorPct}%) with no measured state of health.`);
    } else if (input.measuredSohPct >= plan.sohFloorPct) {
      voided = true;
      reasons.push(`Measured SoH ${input.measuredSohPct}% is at or above the ${plan.sohFloorPct}% floor — not a valid capacity claim.`);
    } else {
      reasons.push(`Measured SoH ${input.measuredSohPct}% is below the ${plan.sohFloorPct}% floor — a valid capacity claim.`);
    }
  }

  if (plan.approvedChargers.length) {
    if (!input.chargerType) {
      review = true;
      reasons.push("No charger recorded — cannot confirm it is an approved accessory.");
    } else if (!plan.approvedChargers.some((c) => c.toLowerCase() === input.chargerType?.trim().toLowerCase())) {
      voided = true;
      reasons.push(`Charger "${input.chargerType}" is not on the approved list (${plan.approvedChargers.join(", ")}).`);
    } else {
      reasons.push(`Charger "${input.chargerType}" is an approved accessory.`);
    }
  }

  if (!input.serviceRecordsComplete) {
    voided = true;
    reasons.push("Service records are incomplete — a free service that fell due was missed.");
  } else {
    reasons.push("Service records complete.");
  }

  if (input.hasOpenDuplicate) {
    review = true;
    reasons.push("Another open claim exists for this component on this chassis — flagged as a possible duplicate.");
  } else {
    reasons.push("No other open claim on this component.");
  }

  return { decision: voided ? "Void" : review ? "Needs review" : "Auto-approve", reasons };
}

/** Claims still in play — the duplicate rule counts these. */
export const OPEN_CLAIM_STATUSES: ReadonlyArray<WarrantyClaim["status"]> = ["Submitted", "Under Review", "Info Requested", "Approved", "In Repair"];

/** The happy path a claim walks, for the stepper. */
export const CLAIM_FLOW = ["Submitted", "Approved", "In Repair", "Reimbursed", "Recovery", "Closed"] as const;

/** Components whose failed part must come back before the dealer is reimbursed — the supplier wants it for recovery. */
export const PART_RETURN_REQUIRED: ReadonlyArray<WarrantyClaim["component"]> = ["Battery Pack", "Motor", "Controller"];

/** Approved cost a claim represents: what was approved, or nothing. */
export const approvedCost = (c: WarrantyClaim) => (c.status === "Rejected" ? 0 : (c.approvedAmount ?? 0));

/** What came back from the supplier on a claim. */
export function recoveredAmount(c: WarrantyClaim): number {
  if (c.recovery?.status === "Recovered") return c.recovery.amount;
  // Rows from before recovery cases existed: "Recovered" meant the approved amount came back.
  if (c.status === "Recovered") return c.approvedAmount ?? c.claimedAmount;
  return 0;
}

/** One component's cover on one vehicle, today. Reads the clock here, not in a component body. */
export function componentCover(component: WarrantyClaim["component"], deliveredAt: string, modelWarranty: string | null | undefined, odometerKm: number | null) {
  const plan = warrantyPlan(component, modelWarranty);
  const ends = coverageEnds(deliveredAt, plan);
  const left = new Date(ends).getTime() - Date.now();
  const withinKm = plan.termKm === null || odometerKm === null || odometerKm <= plan.termKm;
  const state: "In warranty" | "Ends soon" | "Expired" | "Over the km limit" =
    left < 0 ? "Expired" : !withinKm ? "Over the km limit" : left < 60 * 86_400_000 ? "Ends soon" : "In warranty";
  return { plan, ends, state };
}
