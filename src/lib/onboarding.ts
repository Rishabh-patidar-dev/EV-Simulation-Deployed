import type { Application } from "@/server/types";

/**
 * Dealer onboarding — the stage gates and the documents each stage needs,
 * from EV-CRM's applicationRouting.service.ts (its catalog is "List of
 * Documents required at each stage of Onboarding"), mapped onto this app's
 * five stages:
 *
 *   Enquiry       ← the CRM's Screening & NDA
 *   Documents     ← Business Proposal
 *   Verification  ← Due Diligence, plus the six Digital KYC documents
 *   Approval      ← sign-off by the Head of Network Development
 *   Agreement     ← Legal Agreement: LOI, dealership agreement, deposit
 *
 * As in the CRM, an application moves forward only when every required
 * document of the stage it is in has been verified. The stage time limits and
 * the security deposit are the simulation's own policy, labelled on screen.
 */

export const ONBOARDING_STAGES: ReadonlyArray<Application["stage"]> = ["Enquiry", "Documents", "Verification", "Approval", "Agreement"];

export interface StageDocSpec {
  key: string;
  label: string;
  required: boolean;
}

export const STAGE_DOCS: Record<Application["stage"], StageDocSpec[]> = {
  Enquiry: [
    { key: "SIGNED_NDA", label: "Signed non-disclosure agreement (e-stamped)", required: true },
    { key: "EOI_FORM", label: "Expression of Interest form", required: true },
    { key: "CIBIL_REPORTS", label: "CIBIL reports of all partners / directors", required: true },
  ],
  Documents: [
    { key: "DPR", label: "Detailed project report — micro-market and strategy", required: true },
    { key: "FIN_PROJECTIONS_3Y", label: "3-year financial projections (P&L, working capital)", required: true },
    { key: "FUNDING_PROOF", label: "Funding source — sanction letters or 6 months' statements", required: true },
  ],
  Verification: [
    { key: "AUDITED_FINANCIALS_3Y", label: "Audited balance sheets and P&L, last 3 years (CA-signed)", required: true },
    { key: "ITR_3Y", label: "Income tax returns, last 3 assessment years", required: true },
    { key: "BANK_STATEMENTS_12M", label: "Bank statements, last 12 months", required: true },
    { key: "NETWORTH_CERT", label: "CA-certified net worth certificate", required: true },
    { key: "PROPERTY", label: "Showroom property — ownership or registered lease (3–5 yr lock-in)", required: true },
    { key: "FIRE_NOC", label: "Fire department NOC (battery storage)", required: true },
    { key: "SITE_MEDIA", label: "Geo-tagged site photos and 360° walkthrough", required: true },
    { key: "BUILDING_PLANS", label: "Approved building plans", required: false },
    { key: "BANK_NOC", label: "Bank NOC / no-dues certificate", required: false },
  ],
  Approval: [],
  Agreement: [
    { key: "LOI", label: "Letter of Intent issued to the applicant", required: true },
    { key: "DEALER_AGREEMENT", label: "Dealership agreement (Aadhaar e-sign, e-stamped)", required: true },
    { key: "SECURITY_DEPOSIT_PROOF", label: "Security deposit proof (RTGS / NEFT or bank guarantee)", required: true },
    { key: "BOARD_RESOLUTION", label: "Board resolution (private limited company)", required: false },
  ],
};

/** Days an application should spend in each stage before it is chasing. Simulation policy. */
export const STAGE_SLA_DAYS: Record<Application["stage"], number> = { Enquiry: 5, Documents: 14, Verification: 10, Approval: 3, Agreement: 14 };

/** Security deposit by what the applicant is signing up as. Simulation policy. */
export const SECURITY_DEPOSIT: Record<Application["intent"], number> = { Dealer: 500_000, Distributor: 1_500_000, "Service Partner": 200_000 };

/** A new dealer's opening credit limit — four times its deposit. Simulation policy. */
export const CREDIT_MULTIPLE = 4;

export const INVESTMENT_BANDS = ["Under ₹25 L", "₹25–50 L", "₹50 L–1 Cr", "Over ₹1 Cr"] as const;
export const APPLICATION_SOURCES = ["Landing Page", "Referral", "Walk-in", "Expo", "Call Centre"] as const;

export type StageDoc = NonNullable<Application["stageDocs"]>[number];

/** The checklist rows for one stage, as they are created on entering it. */
export function seedStage(stage: Application["stage"]): StageDoc[] {
  return STAGE_DOCS[stage].map((d) => ({ ...d, stage, status: "Not Uploaded" as const, note: null, at: null, by: null }));
}

/** Required documents of the application's current stage that are not verified yet. */
export function blockingDocs(app: Application): StageDoc[] {
  return (app.stageDocs ?? []).filter((d) => d.stage === app.stage && d.required && d.status !== "Verified");
}

/** When the application entered the stage it is in. */
export function stageEnteredAt(app: Application): string {
  return app.stageEnteredAt ?? app.submittedAt;
}

/** Days in the current stage, and whether that is past its limit. Reads the clock here, not in a component body. */
export function stageAge(app: Application, now = Date.now()): { days: number; limit: number; stalled: boolean } {
  const days = Math.floor((now - new Date(stageEnteredAt(app)).getTime()) / 86_400_000);
  const limit = STAGE_SLA_DAYS[app.stage];
  return { days, limit, stalled: app.status === "In Progress" && days > limit };
}

/** How far through the current stage's checklist an application is. */
export function stageProgress(app: Application): { verified: number; total: number } {
  const docs = (app.stageDocs ?? []).filter((d) => d.stage === app.stage);
  return { verified: docs.filter((d) => d.status === "Verified").length, total: docs.length };
}
