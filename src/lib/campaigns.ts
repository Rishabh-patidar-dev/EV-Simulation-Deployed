import type { Booking, Campaign, Deal, Enquiry, LandingPage, Lead, Message, TestDrive } from "@/server/types";

/**
 * Campaign and landing-page results — measured from what actually happened,
 * never typed in. Following EV-CRM's campaign management: a campaign targets
 * a saved segment and snapshots who it went to when it is sent; a landing
 * page's submissions carry its `uniqueId` back, so every enquiry, lead and
 * dealer application is attributed to the page (and the page's campaign).
 *
 *  - Delivery comes from the message log: sent, delivered, read, failed.
 *  - Results are what the people it went to did *after* the send: a lead
 *    that moved to Qualified or beyond, a test drive booked, a deal opened,
 *    a booking made — and the booking value, for ROI.
 */

export interface Delivery {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
}

export function deliveryOf(campaignId: string, messages: Message[]): Delivery {
  const mine = messages.filter((m) => m.related?.kind === "campaign" && m.related.id === campaignId);
  return {
    sent: mine.filter((m) => m.status !== "Failed").length,
    delivered: mine.filter((m) => m.status === "Delivered" || m.status === "Read").length,
    read: mine.filter((m) => m.status === "Read").length,
    failed: mine.filter((m) => m.status === "Failed").length,
  };
}

export interface Results {
  leads: number;
  advanced: number;
  testDrives: number;
  deals: number;
  bookings: number;
  revenue: number;
}

const ADVANCED: ReadonlyArray<Lead["status"]> = ["Qualified", "Test Drive", "Converted"];
const bookingValue = (b: Booking) => (b.unitPrice ?? 0) * (b.quantity ?? 1);

/** What a set of leads went on to do after a moment in time. */
export function resultsFor(
  leadIds: ReadonlySet<string>,
  since: string | null,
  data: { leads: Lead[]; test_drives: TestDrive[]; deals: Deal[]; bookings: Booking[] }
): Results {
  const after = (iso: string) => !since || new Date(iso).getTime() >= new Date(since).getTime();
  const leads = data.leads.filter((l) => leadIds.has(l.id));
  const deals = data.deals.filter((d) => d.leadId && leadIds.has(d.leadId) && after(d.createdAt));
  const dealIds = new Set(deals.map((d) => d.id));
  const bookings = data.bookings.filter((b) => b.dealId && dealIds.has(b.dealId) && b.status !== "Cancelled" && after(b.bookedAt));
  return {
    leads: leads.length,
    advanced: leads.filter((l) => ADVANCED.includes(l.status) && after(l.updatedAt)).length,
    testDrives: data.test_drives.filter((t) => t.leadId && leadIds.has(t.leadId) && after(t.createdAt)).length,
    deals: deals.length,
    bookings: bookings.length,
    revenue: bookings.reduce((s, b) => s + bookingValue(b), 0),
  };
}

/** A campaign's results: what its audience did after the send, or, for a landing-page campaign, what its page produced. */
export function campaignResults(
  c: Campaign,
  data: { leads: Lead[]; test_drives: TestDrive[]; deals: Deal[]; bookings: Booking[]; messages: Message[]; enquiries: Enquiry[] }
): { delivery: Delivery; results: Results; measured: boolean } {
  const delivery = deliveryOf(c.id, data.messages);
  if (c.landingPageId) {
    const ids = new Set(data.leads.filter((l) => l.landingPageId === c.landingPageId || l.campaignId === c.id).map((l) => l.id));
    return { delivery, results: resultsFor(ids, null, data), measured: true };
  }
  if (c.audienceLeadIds?.length) return { delivery, results: resultsFor(new Set(c.audienceLeadIds), c.sentAt ?? null, data), measured: true };
  // A campaign recorded before results were measured: what was typed in is all there is.
  return { delivery, results: { leads: c.leads, advanced: c.responded, testDrives: 0, deals: 0, bookings: 0, revenue: 0 }, measured: false };
}

/** A landing page's funnel: views, submissions split by intent, and what the leads it produced went on to do. */
export function pageFunnel(
  page: LandingPage,
  data: { enquiries: Enquiry[]; leads: Lead[]; test_drives: TestDrive[]; deals: Deal[]; bookings: Booking[]; applications: Array<{ landingPageId?: string | null }> }
) {
  const enquiries = data.enquiries.filter((e) => e.landingPageId === page.id);
  const applications = data.applications.filter((a) => a.landingPageId === page.id).length;
  const leadIds = new Set(data.leads.filter((l) => l.landingPageId === page.id).map((l) => l.id));
  const results = resultsFor(leadIds, null, data);
  const submissions = enquiries.length + applications;
  return {
    enquiries: enquiries.length,
    applications,
    submissions,
    conversion: page.views ? Math.round((submissions / page.views) * 1000) / 10 : null,
    ...results,
  };
}

/** The webhook body the external landing page posts — what attribution hangs on. */
export function webhookSample(page: Pick<LandingPage, "uniqueId" | "intent">): string {
  return JSON.stringify(
    {
      landing_page_campaign_id: page.uniqueId ?? "lp_…",
      intent: page.intent === "Dealership" ? "dealership_application" : "retail_inquiry",
      name: "…",
      phone: "…",
      email: "…",
      city: "…",
      utm_source: "google",
      utm_campaign: "…",
    },
    null,
    2
  );
}
