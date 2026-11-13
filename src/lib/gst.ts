/**
 * GST as a dealer's tax invoice applies it.
 *
 * The place of supply decides the split: a buyer in the dealer's own state
 * pays CGST + SGST (half the rate each), a buyer elsewhere pays IGST. Rates
 * are per line — 5% on an electric vehicle, 18% on accessories, extended
 * warranty and workshop labour, nothing on amounts the dealer only collects
 * on someone else's behalf (registration fees, the insurance premium).
 */

import type { Money, QuoteLine } from "@/server/types";

export const GST_RATE_VEHICLE = 5;
export const GST_RATE_STANDARD = 18;

/** HSN / SAC codes printed on invoices (6-digit, as required above ₹5 Cr turnover). */
export const HSN = {
  passengerVehicle: "870380",
  goodsVehicle: "870460",
  lithiumBattery: "850760",
  motor: "850132",
  controller: "850440",
  bodyPart: "870829",
  electrical: "854430",
  consumable: "870830",
  accessory: "870899",
  /** Maintenance and repair of motor vehicles. */
  workshopLabour: "998714",
  /** Extended warranty — maintenance services sold in advance. */
  extendedWarranty: "998714",
  /** Registration and HSRP fees collected for the RTO. */
  passThrough: "—",
} as const;

/** The first two digits of every GSTIN. */
const GST_STATE_CODES: Record<string, string> = {
  "Jammu and Kashmir": "01",
  "Himachal Pradesh": "02",
  Punjab: "03",
  Chandigarh: "04",
  Uttarakhand: "05",
  Haryana: "06",
  Delhi: "07",
  Rajasthan: "08",
  "Uttar Pradesh": "09",
  Bihar: "10",
  Assam: "18",
  "West Bengal": "19",
  Jharkhand: "20",
  Odisha: "21",
  Chhattisgarh: "22",
  "Madhya Pradesh": "23",
  Gujarat: "24",
  Maharashtra: "27",
  Karnataka: "29",
  Goa: "30",
  Kerala: "32",
  "Tamil Nadu": "33",
  Telangana: "36",
  "Andhra Pradesh": "37",
};

export const INDIAN_STATES = Object.keys(GST_STATE_CODES).sort();

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The GSTIN check character for its first fourteen characters (the published mod-36 scheme). */
function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

/** Shape, known state code and check character — what a GST portal checks before looking the number up. */
export function isValidGstin(value: string): boolean {
  const v = value.trim().toUpperCase();
  if (!GSTIN_SHAPE.test(v)) return false;
  if (!Object.values(GST_STATE_CODES).includes(v.slice(0, 2))) return false;
  return gstinCheckChar(v.slice(0, 14)) === v[14];
}

export function stateOfGstin(value: string): string | undefined {
  const code = value.slice(0, 2);
  return Object.keys(GST_STATE_CODES).find((state) => GST_STATE_CODES[state] === code);
}

export interface TaxedLine extends QuoteLine {
  gross: Money;
  /** This line's share of the invoice discount. */
  discount: Money;
  taxable: Money;
  cgst: Money;
  sgst: Money;
  igst: Money;
  total: Money;
}

export interface TaxBreakdown {
  interState: boolean;
  lines: TaxedLine[];
  gross: Money;
  discount: Money;
  taxable: Money;
  cgst: Money;
  sgst: Money;
  igst: Money;
  total: Money;
  /** Tax per rate — the summary block under a GST invoice. */
  byRate: Array<{ rate: number; taxable: Money; tax: Money }>;
}

/**
 * Taxes a set of lines. The discount comes off the vehicle lines only, in
 * proportion to their value, before tax — a trade discount shown on the
 * invoice reduces the taxable value.
 */
export function computeTax(lines: QuoteLine[], discount: Money, sellerState: string, buyerState: string): TaxBreakdown {
  const interState = sellerState !== buyerState;
  const vehicleGross = lines.filter((l) => l.kind === "Vehicle").reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const cappedDiscount = Math.max(0, Math.min(discount, vehicleGross));

  let discountLeft = cappedDiscount;
  const vehicleLines = lines.filter((l) => l.kind === "Vehicle");
  const taxed: TaxedLine[] = lines.map((line) => {
    const gross = line.quantity * line.unitPrice;
    let share = 0;
    if (line.kind === "Vehicle" && vehicleGross > 0) {
      // The last vehicle line takes the rounding remainder, so the shares add up exactly.
      share = line === vehicleLines[vehicleLines.length - 1] ? discountLeft : Math.round((cappedDiscount * gross) / vehicleGross);
      discountLeft -= share;
    }
    const taxable = gross - share;
    const half = Math.round((taxable * line.gstRate) / 200);
    const cgst = interState ? 0 : half;
    const sgst = interState ? 0 : half;
    const igst = interState ? Math.round((taxable * line.gstRate) / 100) : 0;
    return { ...line, gross, discount: share, taxable, cgst, sgst, igst, total: taxable + cgst + sgst + igst };
  });

  const sum = (pick: (l: TaxedLine) => number) => taxed.reduce((s, l) => s + pick(l), 0);
  const rates = [...new Set(taxed.map((l) => l.gstRate))].sort((a, b) => b - a);
  return {
    interState,
    lines: taxed,
    gross: sum((l) => l.gross),
    discount: cappedDiscount,
    taxable: sum((l) => l.taxable),
    cgst: sum((l) => l.cgst),
    sgst: sum((l) => l.sgst),
    igst: sum((l) => l.igst),
    total: sum((l) => l.total),
    byRate: rates.map((rate) => {
      const at = taxed.filter((l) => l.gstRate === rate);
      return { rate, taxable: at.reduce((s, l) => s + l.taxable, 0), tax: at.reduce((s, l) => s + l.cgst + l.sgst + l.igst, 0) };
    }),
  };
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** "Rupees Twelve Lakh Thirty-Four Thousand Five Hundred Only" — the Indian numbering system, as invoices print it. */
export function amountInWords(amount: Money): string {
  let n = Math.round(Math.abs(amount));
  if (n === 0) return "Rupees Zero Only";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return `Rupees ${parts.join(" ")} Only`;
}

/**
 * A well-formed GSTIN for a business that has not given one: the state's
 * code, a PAN-shaped middle built from the name, and the correct check
 * character. For the simulation's own dealer network only.
 */
export function derivedGstin(name: string, state: string): string {
  let hash = 2166136261;
  for (const ch of name) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  const letters = (n: number, count: number) =>
    Array.from({ length: count }, (_, i) => String.fromCharCode(65 + (Math.floor(n / 26 ** i) % 26))).join("");
  const initial = name.replace(/[^A-Za-z]/g, "").toUpperCase()[0] ?? "X";
  // PAN: three letters, the holder type (F = firm), the name's initial, four digits, a letter.
  const pan = `${letters(hash, 3)}F${initial}${String(hash % 10000).padStart(4, "0")}${letters(hash >>> 7, 1)}`;
  const first14 = `${GST_STATE_CODES[state] ?? "27"}${pan}1Z`;
  return `${first14}${gstinCheckChar(first14)}`;
}

/** The full amount, as a tax invoice prints it: "₹12,34,500". */
export const rupees = (amount: Money) => `₹${Math.round(amount).toLocaleString("en-IN")}`;
