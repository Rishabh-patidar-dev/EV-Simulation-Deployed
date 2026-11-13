"use server";

import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { INDIAN_STATES } from "@/lib/gst";
import { formatMobile, isEmail, isPincode, leastLoadedOwner, mobileDigits, nearestDealer, parseCsv, scoreLead } from "@/lib/leads";
import { VEHICLE_MODELS } from "@/lib/vehicles";
import { runtimeId } from "../ids";
import { assignableStaff } from "../staff";
import { insertRow, readMany, updateRow } from "../store";
import type { Lead } from "../types";
import { gone, isId, refresh } from "./input";
import { saving } from "./outcome";

/**
 * Lead routing and bulk import — EV-CRM's dealer lead routing ("leads passed
 * to the nearest authorised dealer") and its CSV import. Routing picks the
 * dealer by territory, tier and load, and an owner by load; import validates
 * every row, refuses duplicates against the database and within the file,
 * scores what it keeps, and says why each skipped row was skipped.
 */

const MAX_IMPORT_ROWS = 1000;
const MAX_FILE_BYTES = 1_000_000;
const SOURCES: ReadonlyArray<Lead["source"]> = ["Landing Page", "WhatsApp", "Walk-in", "Referral", "Dealer", "Call Centre", "Expo", "Import"];

/** Routes one unassigned lead; returns what happened, without saving when there is nowhere to send it. */
async function route(lead: Lead, all: Lead[], dealers: Parameters<typeof nearestDealer>[1], staff: string[]): Promise<{ ok: true; dealer: string; owner: string; why: string } | { ok: false; why: string }> {
  const match = nearestDealer(lead, dealers, all);
  if (!match) return { ok: false, why: `No active dealer in ${lead.city}${lead.state ? ` or ${lead.state}` : ""}` };
  const owner = leastLoadedOwner(staff, all);
  if (!owner) return { ok: false, why: "Nobody active can take leads — check User Management" };
  const at = new Date().toISOString();
  await updateRow("leads", lead.id, { dealer: match.dealer.name, assignedTo: owner, updatedAt: at, routing: { by: "Territory", why: match.why, at } });
  // Count it against the dealer and the owner straight away, so the next lead in a batch sees the new load.
  lead.dealer = match.dealer.name;
  lead.assignedTo = owner;
  return { ok: true, dealer: match.dealer.name, owner, why: match.why };
}

export async function routeLead(leadId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(leadId)) return gone("lead");
    const [{ data }, staff] = await Promise.all([readMany(["leads", "dealers"] as const), assignableStaff("leads.manage")]);
    const lead = data.leads.find((l) => l.id === leadId);
    if (!lead) return gone("lead");
    if (lead.assignedTo) return failed(`Already with ${lead.assignedTo}`);
    const r = await route(lead, data.leads, data.dealers, staff);
    refresh();
    return r.ok ? succeeded(`${lead.name} → ${r.dealer}`, `Owner ${r.owner} · ${r.why}`) : failed("Not routed", `${r.why}. Assign it by hand.`);
  });
}

/** Every unassigned lead, highest score first, each to its nearest dealer. */
export async function routeAllUnassigned(): Promise<ActionResult> {
  return saving(async () => {
    const [{ data }, staff] = await Promise.all([readMany(["leads", "dealers"] as const), assignableStaff("leads.manage")]);
    const all = data.leads.map((l) => ({ ...l }));
    const waiting = all.filter((l) => !l.assignedTo && l.status !== "Lost" && l.status !== "Converted").sort((a, b) => b.score - a.score);
    if (!waiting.length) return failed("Nothing to route", "Every open lead has an owner.");
    let routed = 0;
    const misses = new Map<string, number>();
    for (const lead of waiting) {
      const r = await route(lead, all, data.dealers, staff);
      if (r.ok) routed++;
      else misses.set(r.why, (misses.get(r.why) ?? 0) + 1);
    }
    refresh();
    const left = [...misses.entries()].map(([why, n]) => `${n} × ${why}`).join("; ");
    return routed
      ? succeeded(`${routed} of ${waiting.length} leads routed`, left ? `Left for you: ${left}.` : "Each went to the nearest dealer with the lightest load.")
      : failed("No lead could be routed", left);
  });
}

/**
 * A CSV of leads. Columns by header, in any order: name (or first name and
 * last name), phone, email, city, state, pincode, model, source. A row needs
 * a name and a phone or email; everything else is optional and scored.
 */
export async function importLeads(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return failed("Choose a CSV file");
    if (file.size > MAX_FILE_BYTES) return failed("That file is over 1 MB", `Split it into files of at most ${MAX_IMPORT_ROWS} rows.`);
    const rows = parseCsv(await file.text());
    if (rows.length < 2) return failed("The CSV has no data rows", "The first row is the header: name, phone, email, city, state, pincode, model, source.");
    if (rows.length - 1 > MAX_IMPORT_ROWS) return failed(`This file has ${rows.length - 1} rows`, `Split it into files of at most ${MAX_IMPORT_ROWS}.`);

    const header = rows[0].map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
    const col = (row: string[], ...names: string[]) => {
      for (const n of names) {
        const i = header.indexOf(n);
        if (i >= 0 && row[i]) return row[i].trim();
      }
      return "";
    };
    if (!header.some((h) => ["name", "firstname", "fullname"].includes(h))) return failed("No name column", "The header needs a name (or first name) column.");

    const autoRoute = fd.get("route") === "on";
    const [{ data }, staff] = await Promise.all([readMany(["leads", "dealers"] as const), assignableStaff("leads.manage")]);
    const all = data.leads.map((l) => ({ ...l }));
    const phones = new Set(all.map((l) => l.phone.replace(/\D/g, "").slice(-10)));
    const emails = new Set(all.map((l) => l.email?.toLowerCase()).filter(Boolean) as string[]);
    const skipped: string[] = [];
    let imported = 0;
    let routed = 0;
    const now = new Date().toISOString();

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const line = r + 1;
      const name = col(row, "name", "fullname") || [col(row, "firstname"), col(row, "lastname")].filter(Boolean).join(" ");
      const phoneRaw = col(row, "phone", "mobile", "phonenumber");
      const email = col(row, "email").toLowerCase() || null;
      const pincode = col(row, "pincode", "pin", "zip") || null;
      const stateRaw = col(row, "state");
      const modelRaw = col(row, "model", "interest", "vehicle");
      const skip = (why: string) => skipped.push(`row ${line}: ${why}`);

      if (name.length < 2) { skip("no name"); continue; }
      if (!phoneRaw && !email) { skip("no phone or email"); continue; }
      const digits = phoneRaw ? mobileDigits(phoneRaw) : null;
      if (phoneRaw && !digits) { skip(`invalid phone ${phoneRaw}`); continue; }
      if (email && !isEmail(email)) { skip(`invalid email ${email}`); continue; }
      if (pincode && !isPincode(pincode)) { skip(`invalid pincode ${pincode}`); continue; }
      if (digits && phones.has(digits)) { skip(`duplicate phone ${phoneRaw}`); continue; }
      if (email && emails.has(email)) { skip(`duplicate email ${email}`); continue; }
      const state = stateRaw ? (INDIAN_STATES.find((s) => s.toLowerCase() === stateRaw.toLowerCase()) ?? null) : null;
      if (stateRaw && !state) { skip(`unknown state ${stateRaw}`); continue; }
      const model = modelRaw ? (VEHICLE_MODELS.find((m) => m.toLowerCase() === modelRaw.toLowerCase()) ?? null) : null;
      const source = SOURCES.find((s) => s.toLowerCase() === col(row, "source").toLowerCase()) ?? "Import";

      // Claim the keys now so a later row in the same file can't reuse them.
      if (digits) phones.add(digits);
      if (email) emails.add(email);

      const phone = digits ? formatMobile(digits) : "";
      const city = col(row, "city") || "Unspecified";
      const scored = scoreLead({ name, phone: phone || undefined, email, city, state, pincode, model: model ?? undefined });
      const lead: Lead = {
        id: runtimeId("LEAD"),
        name,
        phone,
        city,
        model: model ?? "LX EV Cargo",
        source,
        status: "New",
        assignedTo: null,
        dealer: null,
        score: scored.base,
        value: 125_000,
        createdAt: now,
        updatedAt: now,
        nextAction: "Call back",
        dealId: null,
        email,
        state,
        pincode,
        scoreBreakdown: scored,
        routing: null,
      };
      await insertRow("leads", lead);
      all.push(lead);
      imported++;
      if (autoRoute && (await route(lead, all, data.dealers, staff)).ok) routed++;
    }

    refresh();
    const detail = [
      autoRoute ? `${routed} routed to dealers.` : "",
      skipped.length ? `Skipped ${skipped.length}: ${skipped.slice(0, 6).join("; ")}${skipped.length > 6 ? `; and ${skipped.length - 6} more` : ""}.` : "Nothing skipped.",
    ]
      .filter(Boolean)
      .join(" ");
    return imported ? succeeded(`${imported} lead${imported === 1 ? "" : "s"} imported`, detail) : failed("No leads imported", detail);
  });
}
