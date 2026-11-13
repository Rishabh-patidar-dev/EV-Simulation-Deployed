/**
 * Retail finance and the purchase incentive.
 *
 * The loan terms follow what luxusgreen.com publishes for its NBFC panel:
 * rates from 9.5% a year, down payment from 10%, tenure 12–60 months,
 * sanction in 48–72 hours. The EMI is the standard reducing-balance formula —
 * it reproduces the site's own worked example (₹1,50,000 at 11% over 36
 * months = ₹4,911).
 */

import type { Money, Product, VariantPrice } from "@/server/types";

export const LOAN_LIMITS = { minTenure: 12, maxTenure: 60, minDownPct: 10, minRate: 9.5, maxRate: 30 } as const;

/** Hours a lender says it takes to sanction — a case under review longer than this is chased. */
export const SANCTION_SLA_HOURS = 72;

export function emi(principal: Money, annualRatePct: number, months: number): Money {
  if (principal <= 0 || months <= 0) return 0;
  const r = annualRatePct / 1200;
  if (r === 0) return Math.round(principal / months);
  const growth = (1 + r) ** months;
  return Math.round((principal * r * growth) / (growth - 1));
}

/**
 * PM E-DRIVE, as it stands: the L5 three-wheeler window closed on
 * 26 December 2025 once its target was met; registered e-rickshaws and
 * e-carts (L3) still earn ₹2,500 per kWh, capped at ₹12,500 a vehicle, until
 * 31 March 2028.
 */
const PM_EDRIVE = {
  perKwh: 2500,
  capPerVehicle: 12_500,
  l3Until: "2028-03-31T23:59:59+05:30",
  l5ClosedOn: "2025-12-26",
} as const;

/** The incentive on one vehicle of this model and variant, today. */
export function pmEDriveIncentive(product: Pick<Product, "segment" | "subsidyEligible">, variant: Pick<VariantPrice, "batteryKwh">, at = new Date()): Money {
  if (!product.subsidyEligible || product.segment !== "L3") return 0;
  if (at.getTime() > new Date(PM_EDRIVE.l3Until).getTime()) return 0;
  return Math.min(PM_EDRIVE.capPerVehicle, Math.round(variant.batteryKwh * PM_EDRIVE.perKwh));
}
