/**
 * Indicative motor-insurance quotes for a commercial three-wheeler.
 *
 * Not any insurer's tariff: third-party cover is priced per RTO class, own
 * damage as a share of the insured declared value, and each insurer gets its
 * own loading so the comparison has something to compare. Premiums carry
 * 18% GST. The dealer earns a commission on the own-damage premium.
 */

import { INSURERS, type Money, type RTO_CLASSES } from "@/server/types";

/** Third-party premium a year, by class — indicative. */
const TP_PREMIUM: Record<(typeof RTO_CLASSES)[number], Money> = {
  "e-Rickshaw": 2_539,
  "e-Cart": 4_092,
  "L5 Passenger": 2_539,
  "L5 Goods": 4_492,
};

/** Own-damage rate as a share of IDV, before the insurer's loading. */
const OD_RATE = 0.012;

const LOADING: Record<(typeof INSURERS)[number], { od: number; commissionPct: number }> = {
  "ICICI Lombard": { od: 1.04, commissionPct: 15 },
  "Bajaj Allianz": { od: 0.98, commissionPct: 15 },
  "TATA AIG": { od: 1.02, commissionPct: 12.5 },
  "HDFC ERGO": { od: 1.0, commissionPct: 15 },
  "New India Assurance": { od: 0.92, commissionPct: 10 },
  "Go Digit": { od: 0.95, commissionPct: 12.5 },
};

/** IDV of a new vehicle: the ex-showroom price less 5% depreciation. */
export const idvFor = (exShowroom: Money): Money => Math.round(exShowroom * 0.95);

interface InsuranceQuote {
  insurer: (typeof INSURERS)[number];
  cover: "Comprehensive" | "Third Party Only";
  idv: Money;
  odPremium: Money;
  tpPremium: Money;
  gst: Money;
  premium: Money;
  commissionPct: number;
  commission: Money;
}

export function quoteInsurance(idv: Money, rtoClass: (typeof RTO_CLASSES)[number], cover: InsuranceQuote["cover"]): InsuranceQuote[] {
  return INSURERS.map((insurer) => {
    const odPremium = cover === "Comprehensive" ? Math.round(idv * OD_RATE * LOADING[insurer].od) : 0;
    const tpPremium = TP_PREMIUM[rtoClass];
    const gst = Math.round((odPremium + tpPremium) * 0.18);
    const commissionPct = LOADING[insurer].commissionPct;
    return {
      insurer,
      cover,
      idv,
      odPremium,
      tpPremium,
      gst,
      premium: odPremium + tpPremium + gst,
      commissionPct,
      commission: Math.round((odPremium * commissionPct) / 100),
    };
  }).sort((a, b) => a.premium - b.premium);
}
