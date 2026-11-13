/**
 * Quotation arithmetic shared by the screens and the actions, so a quotation
 * shows exactly the figures its tax invoice will carry.
 */

import { computeTax, type TaxBreakdown } from "@/lib/gst";
import type { Deal, Money, Quotation } from "@/server/types";

/** Discounts above this share of the vehicle value need a manager's approval. */
export const DISCOUNT_LIMIT_PCT = 3;

/** Days a quotation stays open. */
export const QUOTE_VALID_DAYS = 15;

/** Booking token taken on conversion, as a share of what the buyer pays. */
export const TOKEN_PCT = 10;

/** A deal still before these moves to "Quotation" when it is quoted. */
export const DEAL_STAGES_BEFORE_QUOTATION: ReadonlyArray<Deal["stage"]> = ["Qualified", "Demo"];

/** Extended warranty, priced as a share of the vehicle's taxable value per year of cover. */
export const EXTENDED_WARRANTY_PCT: Record<string, number> = { "1": 2.5, "2": 4.5 };

interface QuoteTotals extends TaxBreakdown {
  subsidy: Money;
  /** Total less the PM E-DRIVE incentive — what the buyer pays. */
  payable: Money;
  vehicleValue: Money;
  discountPct: number;
  needsApproval: boolean;
}

export function quoteTotals(q: Pick<Quotation, "lines" | "discount" | "subsidy" | "dealerState" | "customerState">): QuoteTotals {
  const tax = computeTax(q.lines, q.discount, q.dealerState, q.customerState);
  const vehicleValue = q.lines.filter((l) => l.kind === "Vehicle").reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const discountPct = vehicleValue ? Math.round((q.discount / vehicleValue) * 1000) / 10 : 0;
  return {
    ...tax,
    subsidy: q.subsidy,
    payable: Math.max(0, tax.total - q.subsidy),
    vehicleValue,
    discountPct,
    needsApproval: discountPct > DISCOUNT_LIMIT_PCT,
  };
}

/** A quotation past its validity reads as expired, whatever status it was left in. */
export function quoteStatus(q: Pick<Quotation, "status" | "validUntil">): Quotation["status"] {
  const open = q.status === "Draft" || q.status === "Sent" || q.status === "Pending Approval";
  return open && new Date(q.validUntil).getTime() < Date.now() ? "Expired" : q.status;
}

/** Vehicles on a quotation. */
export const quoteUnits = (q: Pick<Quotation, "lines">) => q.lines.filter((l) => l.kind === "Vehicle").reduce((s, l) => s + l.quantity, 0);
