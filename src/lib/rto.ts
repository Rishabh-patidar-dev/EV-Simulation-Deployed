/**
 * Registration rules for battery-operated three-wheelers.
 *
 * A vehicle leaves the dealership on a temporary registration valid for one
 * month; the dealer files Form 20 (application), Form 21 (sale certificate)
 * and Form 22 (the maker's roadworthiness certificate) with the insurance,
 * the tax invoice and the owner's address proof. Battery-operated vehicles are
 * exempt from the RC fee and from permits, and carry green plates — yellow
 * characters for a commercial vehicle. Road tax follows each state's EV
 * policy; this simulation records the EV exemption most of them grant.
 */

import type { Money } from "@/server/types";

export const TP_VALID_DAYS = 30;

/** Days before a TP lapses at which an unfinished registration is flagged. */
export const TP_WARNING_DAYS = 7;

export const RTO_STATE_CODES: Record<string, string> = {
  "Jammu and Kashmir": "JK",
  Punjab: "PB",
  Haryana: "HR",
  Delhi: "DL",
  Rajasthan: "RJ",
  "Uttar Pradesh": "UP",
  Bihar: "BR",
  "West Bengal": "WB",
  Jharkhand: "JH",
  Chhattisgarh: "CG",
  "Madhya Pradesh": "MP",
  Gujarat: "GJ",
  Maharashtra: "MH",
  Karnataka: "KA",
  Kerala: "KL",
  "Tamil Nadu": "TN",
  // Telangana moved from TS to TG in 2024.
  Telangana: "TG",
  "Andhra Pradesh": "AP",
};

/** District RTO codes for the cities the network trades in. */
const CITY_RTO: Record<string, string> = {
  Pune: "12",
  Nagpur: "31",
  Ahmedabad: "01",
  Surat: "05",
  Jaipur: "14",
  Lucknow: "32",
  Kanpur: "78",
  Indore: "09",
  Bhopal: "04",
  Ludhiana: "10",
  Patna: "01",
  Ranchi: "01",
  Coimbatore: "37",
  Hyderabad: "09",
  Bengaluru: "01",
  Kochi: "07",
  Bilaspur: "10",
  Faridabad: "51",
};

/** "MH-12 Pune" — the office a vehicle sold in this city is registered at. */
export function rtoOffice(city: string, state: string): string {
  return `${RTO_STATE_CODES[state] ?? "XX"}-${CITY_RTO[city] ?? "01"} ${city}`;
}

/** "MH 12 EV 4821" from the office code and a series and number the RTO allots. */
export function registrationNumber(office: string, series: string, number: number): string {
  const [code] = office.split(" ");
  const [state, district] = code.split("-");
  return `${state} ${district} ${series} ${String(number).padStart(4, "0")}`;
}

export const RTO_FEES: { registration: Money; roadTax: Money; hsrp: Money } = {
  registration: 0,
  roadTax: 0,
  hsrp: 500,
};
