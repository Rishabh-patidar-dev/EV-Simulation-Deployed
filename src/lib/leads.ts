import type { Dealer, Lead } from "@/server/types";

/**
 * Lead rules ported from EV-CRM:
 *
 *  - Scoring (leadScoring.service.ts): completeness over seven profile fields,
 *    about 14.3 points each, weighted 0.7, plus quality — 100 less 10 for a
 *    malformed email or phone — weighted 0.3. That is the lead's base score;
 *    what happens to it afterwards (a test drive's feedback) moves the score
 *    on top of the base, and editing the profile re-scores the base without
 *    losing that.
 *  - Routing (findNearestDealer): the nearest active dealer — same city first,
 *    then same state — then the higher tier, then the one with the fewest
 *    open leads, so routing spreads the load.
 *  - Import (leadsImport.controller.ts): per-row validation, de-duplication by
 *    phone and email against the database and within the file, and a reason
 *    for every row skipped.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE = /^[6-9]\d{9}$/;
const PINCODE = /^\d{6}$/;

/** "+91 98765 43210", "09876543210", "9876543210" → "9876543210"; anything else → null. */
export function mobileDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return MOBILE.test(d) ? d : null;
}

export const formatMobile = (digits: string) => `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
export const isEmail = (v: string | null | undefined) => !!v && EMAIL.test(v.trim());
export const isPincode = (v: string | null | undefined) => !!v && PINCODE.test(v.trim());

export interface LeadScore {
  base: number;
  completeness: number;
  quality: number;
  missing: string[];
  invalid: string[];
}

const PROFILE_FIELDS: Array<[keyof Pick<Lead, "name" | "phone" | "email" | "city" | "state" | "pincode" | "model">, string]> = [
  ["name", "name"],
  ["phone", "phone"],
  ["email", "email"],
  ["city", "city"],
  ["state", "state"],
  ["pincode", "pincode"],
  ["model", "model of interest"],
];

export function scoreLead(lead: Partial<Pick<Lead, "name" | "phone" | "email" | "city" | "state" | "pincode" | "model">>): LeadScore {
  let completeness = 0;
  const missing: string[] = [];
  for (const [key, label] of PROFILE_FIELDS) {
    const v = lead[key];
    if (v && String(v).trim() && v !== "Unspecified") completeness += 14.3;
    else missing.push(label);
  }
  let quality = 100;
  const invalid: string[] = [];
  if (lead.email && !isEmail(lead.email)) {
    quality -= 10;
    invalid.push("email");
  }
  if (lead.phone && !mobileDigits(lead.phone)) {
    quality -= 10;
    invalid.push("phone");
  }
  return { base: Math.round(completeness * 0.7 + quality * 0.3), completeness: Math.round(completeness), quality, missing, invalid };
}

/** The new score after a profile change: the new base plus whatever engagement had added to the old one. */
export function rescore(lead: Lead, next: LeadScore): number {
  const engagement = lead.scoreBreakdown ? lead.score - lead.scoreBreakdown.base : 0;
  return Math.max(0, Math.min(100, next.base + engagement));
}

const TIER_RANK: Record<Dealer["tier"], number> = { Platinum: 4, Gold: 3, Silver: 2, Bronze: 1 };
const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** Leads a dealer is still working — the load routing balances. */
export const openLeadsFor = (dealer: string, leads: Lead[]) => leads.filter((l) => l.dealer === dealer && l.status !== "Converted" && l.status !== "Lost").length;

/** The dealer a lead should go to, and why — or null when no active dealer covers its city or state. */
export function nearestDealer(lead: Pick<Lead, "city" | "state">, dealers: Dealer[], leads: Lead[]): { dealer: Dealer; why: string } | null {
  const city = norm(lead.city);
  // A lead with no state takes the state of a dealer in its city.
  const state = norm(lead.state) || norm(dealers.find((d) => norm(d.city) === city)?.state);
  const scored = dealers
    .filter((d) => d.status === "Active")
    .map((d) => {
      const territory = city && norm(d.city) === city ? 2 : state && norm(d.state) === state ? 1 : 0;
      return { d, territory, tier: TIER_RANK[d.tier], load: openLeadsFor(d.name, leads) };
    })
    .filter((x) => x.territory > 0)
    .sort((a, b) => b.territory - a.territory || b.tier - a.tier || a.load - b.load);
  const best = scored[0];
  if (!best) return null;
  return {
    dealer: best.d,
    why: `${best.territory === 2 ? `same city (${best.d.city})` : `same state (${best.d.state})`} · ${best.d.tier} · ${best.load} open lead${best.load === 1 ? "" : "s"}`,
  };
}

/** The staff member with the fewest open leads — round-robin by load. */
export function leastLoadedOwner(staff: string[], leads: Lead[]): string | null {
  if (!staff.length) return null;
  const load = (name: string) => leads.filter((l) => l.assignedTo === name && l.status !== "Converted" && l.status !== "Lost").length;
  return [...staff].sort((a, b) => load(a) - load(b) || a.localeCompare(b))[0];
}

/**
 * A CSV file as rows of cells — quoted fields, doubled quotes, commas and line
 * breaks inside quotes, CRLF, and a byte-order mark all handled.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}
