import { balance, invoiceState } from "@/lib/receivables";
import { readMany } from "./store";
import { complianceStatus } from "@/lib/compliance";
import { quoteStatus } from "@/lib/quotes";
import { isOpenTicket, slaState } from "@/lib/sla";
import { isLate } from "@/lib/orders";

/**
 * Everything the single dashboard needs, computed in one pass.
 *
 * The point of the simulation is that CRM, DMS and ERP figures sit on one
 * screen and agree with each other — so these are all derived from the same
 * collections the individual module screens read, never from separate
 * hard-coded dashboard numbers.
 */

export interface StatTile {
  key: string;
  label: string;
  value: string;
  /** Percentage change vs. the previous comparable period. */
  delta: number;
  deltaLabel: string;
  tone: "brand" | "neutral";
  /** Whether a rising figure is good news — receivables rising is not. */
  goodWhenUp: boolean;
  /** The screen behind the number. */
  href: string;
}

/** One live line per workspace, for the dashboard's jump-off cards. */
interface WorkspaceSummary {
  key: string;
  title: string;
  detail: string;
  href: string;
}

interface Slice {
  label: string;
  value: number;
}

interface SeriesPoint {
  label: string;
  intake: number;
  billed: number;
}

interface DealerCard {
  name: string;
  code: string;
  tier: string;
  city: string;
  ytdUnits: number;
  targetUnits: number;
  outstanding: number;
  health: number;
}

export interface RecentInvoiceRow {
  invoiceNo: string;
  dealer: string;
  type: string;
  amount: number;
  status: string;
  issuedAt: string;
}

interface TargetRow {
  /** Stable identity for list keys — display names are not guaranteed unique. */
  code: string;
  label: string;
  achieved: number;
  target: number;
}

interface ActivityItem {
  at: string;
  title: string;
  detail: string;
  kind: "lead" | "order" | "invoice" | "claim" | "onboarding";
}

interface DashboardPayload {
  generatedAt: string;
  tiles: StatTile[];
  revenueMix: Slice[];
  leadFunnel: Slice[];
  series: SeriesPoint[];
  networkHealth: { score: number; label: string };
  topDealers: DealerCard[];
  recentInvoices: RecentInvoiceRow[];
  targets: TargetRow[];
  activity: ActivityItem[];
  attention: Array<{ label: string; count: number; href: string }>;
  workspaces: WorkspaceSummary[];
}

const DAY = 86_400_000;
const daysBetween = (iso: string) => (Date.now() - new Date(iso).getTime()) / DAY;

/** Percentage change, guarded against a zero baseline. */
function pctChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export async function buildDashboard(): Promise<DashboardPayload> {
  const { data } = await readMany([
    "leads",
    "deals",
    "bookings",
    "dealers",
    "applications",
    "orders",
    "invoices",
    "vehicle_units",
    "spare_parts",
    "warranty_claims",
    "compliance",
    "follow_ups",
    "approvals",
    "users",
    "quotations",
    "test_drives",
    "tickets",
    "finance_cases",
    "deliveries",
    "registrations",
    "job_cards",
    "sync_queue",
    "connectors",
  ] as const);

  const { leads, deals, bookings, dealers, applications, orders, invoices, vehicle_units, spare_parts, warranty_claims, compliance, follow_ups, users } = data;
  const approvals = data.approvals.filter((a) => (a.status ?? "Pending") === "Pending");
  const openTickets = data.tickets.filter(isOpenTicket);
  const openQuotes = data.quotations.filter((q) => ["Draft", "Sent", "Pending Approval", "Accepted"].includes(quoteStatus(q)));
  const liveLoans = data.finance_cases.filter((c) => c.status === "Applied" || c.status === "Under Review" || c.status === "Sanctioned");
  const openDeliveries = data.deliveries.filter((d) => d.status !== "Handed Over" && d.status !== "Cancelled");
  const openRegistrations = data.registrations.filter((r) => r.status !== "Approved" && r.status !== "RC Issued");
  const workshop = data.job_cards.filter((j) => j.status !== "Closed" && j.status !== "Cancelled");

  // --- headline tiles --------------------------------------------------------

  const billedLast30 = invoices.filter((i) => daysBetween(i.issuedAt) <= 30).reduce((s, i) => s + i.amount, 0);
  const billedPrev30 = invoices.filter((i) => {
    const d = daysBetween(i.issuedAt);
    return d > 30 && d <= 60;
  }).reduce((s, i) => s + i.amount, 0);

  const receivables = invoices.reduce((s, i) => s + balance(i), 0);
  const overdue = invoices.filter((i) => invoiceState(i) === "Overdue");

  const openPipeline = deals.filter((d) => d.stage !== "Booked").reduce((s, d) => s + d.value, 0);
  const bookedValue = bookings.filter((b) => b.status !== "Cancelled").reduce((s, b) => s + b.total, 0);

  const tiles: StatTile[] = [
    {
      key: "billed",
      label: "Billed (30 days)",
      value: formatCompactINR(billedLast30),
      delta: pctChange(billedLast30, billedPrev30),
      deltaLabel: "vs. previous 30 days",
      tone: "brand",
      goodWhenUp: true,
      href: "/dms/orders/invoices",
    },
    {
      key: "receivables",
      label: "Open receivables",
      value: formatCompactINR(receivables),
      delta: pctChange(overdue.length, Math.max(1, invoices.length - overdue.length) / 4),
      deltaLabel: `${overdue.length} invoices overdue`,
      tone: "neutral",
      goodWhenUp: false,
      href: "/dms/orders/invoices",
    },
    {
      key: "pipeline",
      label: "Open pipeline",
      value: formatCompactINR(openPipeline),
      delta: pctChange(deals.filter((d) => d.ageingDays <= 14).length, deals.filter((d) => d.ageingDays > 14 && d.ageingDays <= 28).length),
      deltaLabel: `${deals.filter((d) => d.stage !== "Booked").length} live deals`,
      tone: "neutral",
      goodWhenUp: true,
      href: "/crm/pipeline",
    },
    {
      key: "bookings",
      label: "Confirmed bookings",
      value: formatCompactINR(bookedValue),
      delta: pctChange(bookings.filter((b) => daysBetween(b.bookedAt) <= 15).length, bookings.filter((b) => daysBetween(b.bookedAt) > 15 && daysBetween(b.bookedAt) <= 30).length),
      deltaLabel: `${bookings.filter((b) => b.status !== "Cancelled").length} active bookings`,
      tone: "brand",
      goodWhenUp: true,
      href: "/crm/bookings",
    },
  ];

  // --- breakdowns ------------------------------------------------------------

  const revenueMix: Slice[] = ["Vehicle", "Spare Part", "Service"].map((type) => ({
    label: type,
    value: invoices.filter((i) => i.type === type).reduce((s, i) => s + i.amount, 0),
  }));

  const leadFunnel: Slice[] = ["New", "Contacted", "Qualified", "Test Drive", "Converted"].map((status) => ({
    label: status,
    value: leads.filter((l) => l.status === status).length,
  }));

  // --- 7-day order intake vs. billing ---------------------------------------

  const series: SeriesPoint[] = Array.from({ length: 7 }, (_, idx) => {
    const offset = 6 - idx;
    const start = Date.now() - (offset + 1) * DAY;
    const end = Date.now() - offset * DAY;
    const inWindow = (iso: string) => {
      const t = new Date(iso).getTime();
      return t >= start && t < end;
    };
    return {
      label: new Date(end).toLocaleDateString("en-IN", { weekday: "short" }),
      intake: orders.filter((o) => inWindow(o.placedAt)).reduce((s, o) => s + o.value, 0),
      billed: invoices.filter((i) => inWindow(i.issuedAt)).reduce((s, i) => s + i.amount, 0),
    };
  });

  // --- network health --------------------------------------------------------

  const activeDealers = dealers.filter((d) => d.status === "Active");
  const avgHealth = activeDealers.length
    ? Math.round(activeDealers.reduce((s, d) => s + d.health, 0) / activeDealers.length)
    : 0;

  const topDealers: DealerCard[] = [...dealers]
    .sort((a, b) => b.ytdUnits / b.targetUnits - a.ytdUnits / a.targetUnits)
    .slice(0, 2)
    .map((d) => ({
      name: d.name,
      code: d.code,
      tier: d.tier,
      city: d.city,
      ytdUnits: d.ytdUnits,
      targetUnits: d.targetUnits,
      outstanding: d.outstanding,
      health: d.health,
    }));

  const recentInvoices: RecentInvoiceRow[] = [...invoices]
    .sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt))
    .slice(0, 6)
    .map((i) => ({ invoiceNo: i.invoiceNo, dealer: i.dealer, type: i.type, amount: i.amount, status: invoiceState(i), issuedAt: i.issuedAt }));

  const targets: TargetRow[] = [...dealers]
    .sort((a, b) => b.targetUnits - a.targetUnits)
    .slice(0, 4)
    .map((d) => ({ code: d.code, label: d.name, achieved: d.ytdUnits, target: d.targetUnits }));

  // --- activity feed ---------------------------------------------------------

  const activity: ActivityItem[] = [
    ...leads.slice(0, 20).map((l) => ({
      at: l.createdAt,
      title: `Lead captured — ${l.name}`,
      detail: `${l.source} · ${l.city}${l.dealer ? ` · routed to ${l.dealer}` : " · unassigned"}`,
      kind: "lead" as const,
    })),
    ...orders.slice(0, 12).map((o) => ({
      at: o.placedAt,
      title: `Order ${o.orderNo} ${o.status.toLowerCase()}`,
      detail: `${o.dealer} · ${o.units} units · ${formatCompactINR(o.value)}`,
      kind: "order" as const,
    })),
    ...invoices.slice(0, 12).map((i) => ({
      at: i.issuedAt,
      title: `Invoice ${i.invoiceNo} — ${invoiceState(i).toLowerCase()}`,
      detail: `${i.dealer} · ${formatCompactINR(i.amount)}`,
      kind: "invoice" as const,
    })),
    ...warranty_claims.slice(0, 10).map((c) => ({
      at: c.raisedAt,
      title: `Warranty claim ${c.claimNo}`,
      detail: `${c.component} · ${c.dealer} · ${c.status}`,
      kind: "claim" as const,
    })),
    ...applications.slice(0, 10).map((a) => ({
      at: a.submittedAt,
      title: `${a.firm} — ${a.stage}`,
      detail: `${a.intent} application · ${a.city} · ${a.status}`,
      kind: "onboarding" as const,
    })),
  ]
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
    .slice(0, 12);

  // --- what needs a human ----------------------------------------------------

  const attention = [
    { label: "Unassigned leads", count: leads.filter((l) => !l.assignedTo).length, href: "/crm/leads/unassigned" },
    { label: "Overdue follow-ups", count: follow_ups.filter((f) => f.status === "Overdue").length, href: "/crm/follow-ups" },
    { label: "Dealer orders to acknowledge", count: orders.filter((o) => o.status === "Placed").length, href: "/dms/orders?status=Placed" },
    { label: "Late dealer orders", count: orders.filter((o) => isLate(o)).length, href: "/dms/orders?late=1" },
    { label: "Overdue invoices", count: overdue.length, href: "/dms/orders/invoices" },
    { label: "Expired compliance docs", count: compliance.filter((c) => complianceStatus(c.expiresOn) === "Expired").length, href: "/dms/dealers/compliance" },
    { label: "Claims under review", count: warranty_claims.filter((c) => c.status === "Under Review").length, href: "/dms/service/warranty" },
    { label: "Parts below reorder level", count: spare_parts.filter((p) => p.onHand < p.reorderLevel).length, href: "/dms/inventory/spare-parts" },
    { label: "Vehicles ageing over 90 days", count: vehicle_units.filter((v) => v.status === "In Stock" && v.ageingDays > 90).length, href: "/dms/inventory/vehicles" },
    { label: "Approvals pending", count: approvals.length, href: "/erp/access#approvals" },
    { label: "Support tickets past SLA", count: openTickets.filter((t) => slaState(t).resolutionBreached).length, href: "/crm/support" },
    { label: "Quotations awaiting discount approval", count: openQuotes.filter((q) => q.status === "Pending Approval").length, href: "/dms/quotations?status=Pending%20Approval" },
    { label: "Deliveries overdue", count: openDeliveries.filter((d) => new Date(d.scheduledFor).getTime() < Date.now()).length, href: "/dms/orders/delivery" },
    { label: "TPs lapsing within a week", count: openRegistrations.filter((r) => new Date(r.tpValidUntil).getTime() - Date.now() < 7 * DAY).length, href: "/dms/rto" },
    { label: "Accounting vouchers refused", count: data.sync_queue.filter((q) => q.status === "Failed").length, href: "/erp/accounting?status=Failed" },
    { label: "Integrations down", count: data.connectors.filter((c) => c.status !== "Connected").length, href: "/erp/integrations" },
  ].filter((a) => a.count > 0);

  // --- workspace jump-offs ----------------------------------------------------

  const weekAgo = (iso: string) => daysBetween(iso) <= 7;
  const workspaces: WorkspaceSummary[] = [
    {
      key: "leads",
      title: "Leads",
      detail: `${leads.filter((l) => weekAgo(l.createdAt)).length} new this week · ${leads.filter((l) => !l.assignedTo).length} unassigned`,
      href: "/crm/leads",
    },
    {
      key: "pipeline",
      title: "Pipeline & bookings",
      detail: `${deals.filter((d) => d.stage !== "Booked").length} live deals · ${bookings.filter((b) => b.status !== "Cancelled" && b.status !== "Delivered").length} bookings to deliver`,
      href: "/crm/pipeline",
    },
    {
      key: "dealers",
      title: "Dealer network",
      detail: `${activeDealers.length} active dealers · ${applications.filter((a) => a.status === "In Progress").length} applications onboarding`,
      href: "/dms/dealers",
    },
    {
      key: "stock",
      title: "Vehicle stock",
      detail: `${vehicle_units.filter((v) => v.status === "In Stock").length} units in stock · ${vehicle_units.filter((v) => v.status === "In Stock" && v.ageingDays > 90).length} ageing past 90 days`,
      href: "/dms/inventory/vehicles",
    },
    {
      key: "orders",
      title: "Order management",
      detail: `${orders.filter((o) => o.status === "Placed").length} to acknowledge · ${orders.filter((o) => isLate(o)).length} running late`,
      href: "/dms/orders",
    },
    {
      key: "billing",
      title: "Billing",
      detail: `${formatCompactINR(receivables)} receivable · ${overdue.length} invoices overdue`,
      href: "/dms/orders/invoices",
    },
    {
      key: "retail",
      title: "Quotes, loans & delivery",
      detail: `${openQuotes.length} open quotations · ${liveLoans.length} loans in progress · ${openDeliveries.length} deliveries to hand over`,
      href: "/dms/quotations",
    },
    {
      key: "rto",
      title: "Registration",
      detail: `${openRegistrations.length} vehicles awaiting their number · ${data.test_drives.filter((d) => d.status === "Scheduled").length} test drives booked`,
      href: "/dms/rto",
    },
    {
      key: "aftersales",
      title: "After-sales",
      detail: `${workshop.length} job cards open · ${openTickets.length} support tickets · ${warranty_claims.filter((c) => c.status === "Under Review").length} claims under review`,
      href: "/dms/service/jobcards",
    },
    {
      key: "access",
      title: "People & approvals",
      detail: `${users.filter((u) => u.status === "Active").length} active users · ${approvals.length} approvals pending`,
      href: "/admin/users",
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    tiles,
    revenueMix,
    leadFunnel,
    series,
    networkHealth: { score: avgHealth, label: healthLabel(avgHealth) },
    topDealers,
    recentInvoices,
    targets,
    activity,
    attention,
    workspaces,
  };
}

function healthLabel(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Healthy";
  if (score >= 55) return "Watch";
  return "At risk";
}

/** ₹15.4L / ₹1.87Cr — the units an Indian dealer network actually reads in. */
function formatCompactINR(value: number): string {
  if (Math.abs(value) >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)} Cr`;
  if (Math.abs(value) >= 100_000) return `₹${(value / 100_000).toFixed(2)} L`;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}
