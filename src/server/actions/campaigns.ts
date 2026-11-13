"use server";

import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { INDIAN_STATES } from "@/lib/gst";
import { isEmail, mobileDigits, nearestDealer } from "@/lib/leads";
import { INVESTMENT_BANDS } from "@/lib/onboarding";
import { segmentLeads } from "@/lib/segments";
import { VEHICLE_MODELS } from "@/lib/vehicles";
import { runtimeId } from "../ids";
import { alphaRef, nextNumber } from "../numbering";
import { assignableStaff } from "../staff";
import { insertRow, readMany, updateRow } from "../store";
import type { Campaign, Enquiry, LandingPage } from "../types";
import { sendMessage } from "../workflows/messaging";
import { openApplication } from "../workflows/onboarding";
import { gone, int, isId, oneOf, phoneField, refresh, str, type Prev } from "./input";
import { saving } from "./outcome";

/**
 * Campaigns and landing pages — EV-CRM's campaign management and landing-page
 * campaigns. A campaign targets a saved segment and goes out through the
 * messaging connectors; who it went to is snapshotted so its results can be
 * measured. A landing page carries a unique id the external page posts back
 * with every submission; a retail submission becomes an attributed enquiry
 * routed to the nearest dealer, a dealership one an onboarding application.
 */

const CHANNELS = ["WhatsApp", "SMS", "Email", "Landing Page"] as const satisfies readonly Campaign["channel"][];
const INTENTS = ["Retail", "Dealership", "Both"] as const;
const MAX_AUDIENCE = 2000;

export async function createCampaign(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const name = str(fd, "name", 120);
    if (name.length < 3) return failed("Give the campaign a name");
    const channel = oneOf(fd, "channel", CHANNELS);
    if (!channel) return failed("Choose a channel");
    const spend = int(fd, "spend", 0, 100_000_000) ?? 0;
    const { data } = await readMany(["segments", "message_templates", "landing_pages"] as const);

    let segmentId: string | null = null;
    let template: string | null = null;
    let landingPageId: string | null = null;
    if (channel === "Landing Page") {
      landingPageId = str(fd, "landingPageId", 64);
      if (!data.landing_pages.some((p) => p.id === landingPageId)) return failed("Choose the landing page it drives traffic to");
    } else {
      segmentId = str(fd, "segmentId", 64);
      if (!data.segments.some((s) => s.id === segmentId)) return failed("Choose the segment it goes to");
      if (channel !== "Email") {
        template = str(fd, "template", 80);
        if (!data.message_templates.some((t) => t.channel === channel && t.name === template)) return failed(`Choose a ${channel} template`, "Templates are managed under API Integrations → Templates.");
      }
    }
    const message = str(fd, "message", 1000) || null;
    if (channel === "Email" && (!message || message.length < 10)) return failed("Write the email");

    const campaign: Campaign = {
      id: runtimeId("CMP"),
      name,
      channel,
      status: "Scheduled",
      spend,
      reached: 0,
      responded: 0,
      leads: 0,
      startedAt: new Date().toISOString(),
      segmentId,
      template,
      message,
      landingPageId,
      sentAt: null,
      audience: null,
      audienceLeadIds: [],
    };
    await insertRow("campaigns", campaign);
    if (landingPageId) await updateRow("landing_pages", landingPageId, { campaignId: campaign.id });
    refresh();
    return succeeded(`Campaign scheduled — ${name}`, channel === "Landing Page" ? "Attributed to its page's submissions." : "Send it from its page when ready.");
  });
}

/**
 * Sends a segment campaign to every member the channel can reach, through the
 * messaging connector — each message lands in the message log, failures
 * included. Email has no connector in this simulation, so its sends are
 * recorded, not delivered.
 */
export async function sendCampaign(campaignId: string): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(campaignId)) return gone("campaign");
    const { data } = await readMany(["campaigns", "segments", "leads"] as const);
    const c = data.campaigns.find((x) => x.id === campaignId);
    if (!c) return gone("campaign");
    if (c.sentAt) return failed("Already sent", `It went to ${c.audience ?? 0} people.`);
    if (c.channel === "Landing Page") return failed("A landing-page campaign is not sent", "Publish its page — submissions are attributed to it.");
    const segment = data.segments.find((s) => s.id === c.segmentId);
    if (!segment) return failed("Its segment no longer exists", "Edit the campaign or create it again.");

    const members = segmentLeads(data.leads, segment.filter);
    const reachable = c.channel === "Email" ? members.filter((l) => isEmail(l.email)) : members.filter((l) => mobileDigits(l.phone));
    // One message per person, even if a phone or email is on two leads.
    const seen = new Set<string>();
    const audience = reachable.filter((l) => {
      const key = c.channel === "Email" ? (l.email ?? "").toLowerCase() : (mobileDigits(l.phone) ?? "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!audience.length) return failed(`Nobody in “${segment.name}” can be reached by ${c.channel}`, `${members.length} member${members.length === 1 ? "" : "s"}, none with a ${c.channel === "Email" ? "valid email" : "valid mobile"}.`);
    if (audience.length > MAX_AUDIENCE) return failed(`${audience.length} people is more than one send takes`, `Narrow the segment to ${MAX_AUDIENCE} or fewer.`);

    let ok = 0;
    let lastError: string | null = null;
    if (c.channel === "Email") ok = audience.length;
    else {
      for (const lead of audience) {
        const m = await sendMessage({
          channel: c.channel as "WhatsApp" | "SMS",
          template: c.template ?? "",
          to: lead.phone,
          customer: lead.name,
          vars: [lead.name, lead.model, lead.dealer ?? "your nearest Luxus Green dealer"],
          related: { kind: "campaign", id: c.id, label: c.name },
        });
        if (m.status === "Failed") lastError = m.error;
        else ok++;
      }
    }
    const at = new Date().toISOString();
    await updateRow("campaigns", c.id, { status: "Running", sentAt: at, audience: audience.length, audienceLeadIds: audience.map((l) => l.id), reached: ok, startedAt: at });
    refresh();
    if (c.channel === "Email") return succeeded(`Sent to ${ok} people`, "Email has no connector in this simulation — the send is recorded, results are measured on the leads.");
    return ok
      ? succeeded(`Sent to ${ok} of ${audience.length}`, ok < audience.length ? `${audience.length - ok} failed: ${lastError}.` : "Delivery and read receipts arrive in API Integrations → Messages.")
      : failed(`None of the ${audience.length} messages went`, lastError ?? undefined);
  });
}

export async function createLandingPage(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    const name = str(fd, "name", 120);
    const slug = str(fd, "slug", 80).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!name || slug.length < 3) return failed("Add a name and a slug", "Lower case, dashes between words — e.g. cargo-offer.");
    const intent = oneOf(fd, "intent", INTENTS) ?? "Retail";
    const gtm = str(fd, "gtmContainerId", 20).toUpperCase() || null;
    if (gtm && !/^GTM-[A-Z0-9]{4,10}$/.test(gtm)) return failed("A Google Tag Manager id looks like GTM-XXXXXXX");
    const { data } = await readMany(["landing_pages"] as const);
    if (data.landing_pages.some((p) => p.slug === slug)) return failed(`/${slug} is already taken`);
    const page: LandingPage = {
      id: runtimeId("LP"),
      name,
      slug,
      status: "Draft",
      views: 0,
      submissions: 0,
      updatedAt: new Date().toISOString(),
      uniqueId: `lp_${alphaRef(10).toLowerCase()}`,
      intent,
      campaignId: null,
      gtmContainerId: gtm,
    };
    await insertRow("landing_pages", page);
    refresh();
    return succeeded("Landing page drafted", `/${slug} · id ${page.uniqueId}`);
  });
}

/** Visits reported by the page's analytics — what the conversion rate is worked out against. */
export async function addPageViews(pageId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(pageId)) return gone("landing page");
    const views = int(fd, "views", 1, 1_000_000);
    if (views === null) return failed("Visits are 1–10,00,000");
    const { data } = await readMany(["landing_pages"] as const);
    const page = data.landing_pages.find((p) => p.id === pageId);
    if (!page) return gone("landing page");
    await updateRow("landing_pages", page.id, { views: page.views + views, updatedAt: new Date().toISOString() });
    refresh();
    return succeeded(`${views.toLocaleString("en-IN")} visits added`, `${(page.views + views).toLocaleString("en-IN")} in all.`);
  });
}

/**
 * A submission from the live page — what its webhook would deliver. Routed by
 * intent, as EV-CRM's ingest does: retail becomes an enquiry with the nearest
 * dealer, a dealership application opens in the onboarding pipeline.
 */
export async function captureSubmission(pageId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(pageId)) return gone("landing page");
    const [{ data }, networkStaff] = await Promise.all([readMany(["landing_pages", "enquiries", "dealers", "leads", "applications"] as const), assignableStaff("onboarding.manage")]);
    const page = data.landing_pages.find((p) => p.id === pageId);
    if (!page) return gone("landing page");
    if (page.status !== "Live") return failed("The page is not live", "Publish it before it can take submissions.");

    const asked = oneOf(fd, "intent", ["Retail", "Dealership"] as const);
    const intent = page.intent === "Both" ? asked : (page.intent ?? "Retail");
    if (!intent) return failed("Retail enquiry or dealership application?");
    const name = str(fd, "name", 80);
    if (name.length < 2) return failed("Name the person submitting");
    const phone = phoneField(fd, "phone");
    if (!phone) return failed("Enter a 10-digit mobile number");
    const email = str(fd, "email", 120).toLowerCase() || null;
    if (email && !isEmail(email)) return failed("That email address is not valid");
    const city = str(fd, "city", 60);
    if (city.length < 2) return failed("Which city?");
    const state = str(fd, "state") ? oneOf(fd, "state", INDIAN_STATES) : null;
    const utmSource = str(fd, "utmSource", 40) || null;

    let detail: string;
    if (intent === "Retail") {
      const model = oneOf(fd, "model", VEHICLE_MODELS) ?? VEHICLE_MODELS[0];
      const match = nearestDealer({ city, state }, data.dealers, data.leads);
      const enquiry: Enquiry = {
        id: runtimeId("ENQ"),
        reference: nextNumber(
          data.enquiries.map((e) => e.reference),
          "ENQ",
          1200
        ),
        customer: name,
        phone,
        model,
        channel: "Landing Page",
        dealer: match?.dealer.name ?? data.dealers.find((d) => d.status === "Active")?.name ?? "Unrouted",
        status: "Open",
        value: 125_000,
        createdAt: new Date().toISOString(),
        leadId: null,
        landingPageId: page.id,
        campaignId: page.campaignId ?? null,
        utmSource,
        email,
        city,
      };
      await insertRow("enquiries", enquiry);
      detail = `Enquiry ${enquiry.reference} · ${model} · ${match ? `to ${match.dealer.name} (${match.why})` : "no dealer near — routed to the first active dealer"}`;
    } else {
      const firm = str(fd, "firm", 80);
      if (firm.length < 2) return failed("Name the firm applying");
      if (!state) return failed("Choose the state", "A dealership application needs its state.");
      if (data.applications.some((a) => a.firm.toLowerCase() === firm.toLowerCase() && (a.status === "In Progress" || a.status === "On Hold"))) return failed(`${firm} already has an open application`);
      const application = await openApplication({
        firm,
        city,
        state,
        intent: "Dealer",
        // The onboarding owner with the fewest open applications.
        owner:
          [...networkStaff].sort(
            (a, b) =>
              data.applications.filter((x) => x.owner === a && x.status === "In Progress").length - data.applications.filter((x) => x.owner === b && x.status === "In Progress").length || a.localeCompare(b)
          )[0] ?? "Unassigned",
        contactName: name,
        phone,
        email,
        gstin: null,
        pan: null,
        investment: oneOf(fd, "investment", INVESTMENT_BANDS),
        source: "Landing Page",
        landingPageId: page.id,
        note: `From landing page /${page.slug}${utmSource ? ` · utm_source ${utmSource}` : ""}`,
      });
      detail = `Application ${application.applicationNo} opened in the onboarding pipeline`;
    }
    await updateRow("landing_pages", page.id, { submissions: page.submissions + 1, views: Math.max(page.views, page.submissions + 1), updatedAt: new Date().toISOString() });
    refresh();
    return succeeded(`Submission captured on /${page.slug}`, detail);
  });
}
