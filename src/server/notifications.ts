import "server-only";
import type { AppNotification } from "@/lib/notifications";
import { complianceStatus } from "@/lib/compliance";
import { SANCTION_SLA_HOURS } from "@/lib/finance";
import { stageAge, stageEnteredAt } from "@/lib/onboarding";
import { isLate } from "@/lib/orders";
import { balance, invoiceState } from "@/lib/receivables";
import { TP_WARNING_DAYS } from "@/lib/rto";
import { isOpenTicket, slaState } from "@/lib/sla";
import { readMany } from "./store";

const DAY = 86_400_000;

/**
 * Everything that needs a human right now — dated items newest first, then
 * standing conditions. The complete list: the bell shows the latest of it, the
 * Notifications page all of it, and both count from the same set. Derived from the
 * same collections the module screens read, so the bell can never disagree
 * with the screen it links to.
 */
export async function buildNotifications(): Promise<AppNotification[]> {
  const { data } = await readMany([
    "leads",
    "follow_ups",
    "invoices",
    "compliance",
    "approvals",
    "warranty_claims",
    "spare_parts",
    "orders",
    "tickets",
    "finance_cases",
    "deliveries",
    "registrations",
    "job_cards",
    "sync_queue",
    "applications",
    "part_orders",
  ] as const);
  const now = Date.now();
  const hoursAgo = (iso: string) => (now - new Date(iso).getTime()) / 3_600_000;
  const short = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

  const newest = <T,>(rows: T[], at: (row: T) => string) => [...rows].sort((a, b) => +new Date(at(b)) - +new Date(at(a)));

  const items: Array<Omit<AppNotification, "ago">> = [
    ...newest(
      data.leads.filter((l) => !l.assignedTo && l.status === "New"),
      (l) => l.createdAt
    ).map((l) => ({
      id: `lead_unassigned:${l.id}`,
      type: "lead_unassigned" as const,
      title: `New lead waiting — ${l.name}`,
      message: `${l.source} · ${l.city} · interested in ${l.model}`,
      href: `/crm/leads/${l.id}`,
      at: l.createdAt,
    })),
    ...newest(
      data.follow_ups.filter((f) => f.status === "Overdue"),
      (f) => f.dueAt
    ).map((f) => ({
      id: `followup_overdue:${f.id}`,
      type: "followup_overdue" as const,
      title: `Follow-up overdue — ${f.customer}`,
      message: `${f.subject} · ${f.channel} · owner ${f.owner}`,
      href: "/crm/follow-ups",
      at: f.dueAt,
    })),
    ...newest(
      data.orders.filter((o) => o.status === "Placed"),
      (o) => o.placedAt
    ).map((o) => ({
      id: `order_waiting:${o.id}`,
      type: "order_waiting" as const,
      title: `Order ${o.orderNo} awaiting acknowledgement`,
      message: `${o.dealer} · ${o.units} units · ${inr(o.value)}`,
      href: `/dms/orders/${o.id}`,
      at: o.placedAt,
    })),
    ...newest(
      data.orders.filter((o) => o.status === "Stock Short" && !o.notice),
      (o) => o.stockCheck?.at ?? o.placedAt
    ).map((o) => ({
      id: `order_short:${o.id}`,
      type: "order_short" as const,
      title: `Order ${o.orderNo} is short of stock`,
      message: `${o.dealer} · ${o.units} units · send the dealer an out-of-stock notice`,
      href: `/dms/orders/${o.id}`,
      at: o.stockCheck?.at ?? o.placedAt,
    })),
    ...newest(
      data.part_orders.filter((o) => o.status === "Short" && !o.notice),
      (o) => o.stockCheck?.at ?? o.placedAt
    ).map((o) => ({
      id: `order_short:${o.id}`,
      type: "order_short" as const,
      title: `Parts order ${o.orderNo} is short of stock`,
      message: `${o.dealer} · ${o.lines.length} line${o.lines.length === 1 ? "" : "s"} · send the dealer an out-of-stock notice`,
      href: `/dms/inventory/spare-parts/orders/${o.id}`,
      at: o.stockCheck?.at ?? o.placedAt,
    })),
    ...newest(
      data.orders.filter((o) => isLate(o)),
      (o) => o.expectedBy
    ).map((o) => ({
      id: `order_late:${o.id}`,
      type: "order_late" as const,
      title: `Order ${o.orderNo} is late`,
      message: `${o.dealer} · ${o.status} · was expected ${new Date(o.expectedBy).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`,
      href: `/dms/orders/${o.id}`,
      at: o.expectedBy,
    })),
    ...newest(
      data.invoices.filter((i) => invoiceState(i) === "Overdue"),
      (i) => i.dueOn
    ).map((i) => ({
      id: `invoice_overdue:${i.id}`,
      type: "invoice_overdue" as const,
      title: `Invoice ${i.invoiceNo} overdue`,
      message: `${i.dealer} · ${inr(balance(i))} outstanding`,
      href: `/dms/orders/invoices/${i.id}`,
      at: i.dueOn,
    })),
    ...newest(
      data.compliance.filter((c) => complianceStatus(c.expiresOn) === "Expired"),
      (c) => c.expiresOn
    ).map((c) => ({
      id: `compliance_expired:${c.id}`,
      type: "compliance_expired" as const,
      title: `${c.docType} expired`,
      message: `${c.dealer} · ref ${c.reference}`,
      href: "/dms/dealers/compliance",
      at: c.expiresOn,
    })),
    ...newest(
      data.approvals.filter((a) => (a.status ?? "Pending") === "Pending" && hoursAgo(a.raisedAt) > 48),
      (a) => a.raisedAt
    ).map((a) => ({
      id: `approval_pending:${a.id}`,
      type: "approval_pending" as const,
      title: `${a.type} approval waiting ${Math.round(hoursAgo(a.raisedAt) / 24)} days`,
      message: `${a.subject} · raised by ${a.requestedBy}, with ${a.pendingWith}`,
      href: "/erp/access#approvals",
      at: a.raisedAt,
    })),
    ...newest(
      data.warranty_claims.filter((c) => c.status === "Under Review" || c.status === "Submitted"),
      (c) => c.raisedAt
    ).map((c) => ({
      id: `claim_review:${c.id}`,
      type: "claim_review" as const,
      title: `Warranty claim ${c.claimNo} needs a decision`,
      message: `${c.component} · ${c.dealer} · ${inr(c.claimedAmount)}`,
      href: `/dms/service/warranty/${c.id}`,
      at: c.raisedAt,
    })),
    ...newest(
      data.tickets.filter((t) => isOpenTicket(t) && slaState(t).resolutionBreached),
      (t) => t.resolveBy
    ).map((t) => ({
      id: `ticket_breach:${t.id}`,
      type: "ticket_breach" as const,
      title: `${t.priority} ticket past SLA — ${t.customer}`,
      message: `${t.ticketNo} · ${t.subject} · with ${t.escalatedTo ?? t.assignee}`,
      href: `/crm/support/${t.id}`,
      at: t.resolveBy,
    })),
    ...newest(
      data.finance_cases.filter((c) => c.status === "Under Review" && hoursAgo([...c.history].reverse().find((e) => e.status === "Under Review")?.at ?? c.appliedAt) > SANCTION_SLA_HOURS),
      (c) => c.appliedAt
    ).map((c) => ({
      id: `loan_stalled:${c.id}`,
      type: "loan_stalled" as const,
      title: `Loan ${c.caseNo} with ${c.financier} over ${SANCTION_SLA_HOURS}h`,
      message: `${c.customer} · ${inr(c.loanAmount)} · chase the sanction`,
      href: `/dms/finance-insurance/${c.id}`,
      at: c.appliedAt,
    })),
    ...newest(
      data.deliveries.filter((d) => (d.status === "Scheduled" || d.status === "PDI Done") && new Date(d.scheduledFor).getTime() < now),
      (d) => d.scheduledFor
    ).map((d) => ({
      id: `delivery_overdue:${d.id}`,
      type: "delivery_overdue" as const,
      title: `Delivery ${d.deliveryNo} overdue`,
      message: `${d.customer} · ${d.quantity} × ${d.model} · was due ${short(d.scheduledFor)} · ${d.status}`,
      href: `/dms/orders/delivery/${d.id}`,
      at: d.scheduledFor,
    })),
    ...newest(
      data.registrations.filter((r) => r.status !== "Approved" && r.status !== "RC Issued" && new Date(r.tpValidUntil).getTime() - now < TP_WARNING_DAYS * DAY),
      (r) => r.tpValidUntil
    ).map((r) => ({
      id: `tp_expiring:${r.id}`,
      type: "tp_expiring" as const,
      title: new Date(r.tpValidUntil).getTime() < now ? `TP lapsed — ${r.vin}` : `TP lapses ${short(r.tpValidUntil)} — ${r.vin}`,
      message: `${r.customer} · ${r.model} · ${r.status} at ${r.rtoOffice}`,
      href: `/dms/rto/${r.id}`,
      at: r.tpValidUntil,
    })),
    ...newest(
      data.job_cards.filter((j) => ["Open", "In Progress", "Awaiting Parts"].includes(j.status) && new Date(j.promisedAt).getTime() < now),
      (j) => j.promisedAt
    ).map((j) => ({
      id: `job_overdue:${j.id}`,
      type: "job_overdue" as const,
      title: `${j.jobNo} past its promised time`,
      message: `${j.customer} · ${j.model} · ${j.status} · ${j.technician}`,
      href: `/dms/service/jobcards/${j.id}`,
      at: j.promisedAt,
    })),
    ...newest(
      data.applications.filter((a) => stageAge(a).stalled),
      (a) => stageEnteredAt(a)
    ).map((a) => {
      const age = stageAge(a);
      return {
        id: `onboarding_stalled:${a.id}:${a.stage}`,
        type: "onboarding_stalled" as const,
        title: `${a.firm} stalled at ${a.stage}`,
        message: `${a.applicationNo} · ${age.days} days against ${age.limit} · owner ${a.owner}`,
        href: `/dms/onboarding/${a.id}`,
        at: stageEnteredAt(a),
      };
    }),
    ...newest(
      data.sync_queue.filter((q) => q.status === "Failed"),
      (q) => q.queuedAt
    ).map((q) => ({
      id: `sync_failed:${q.id}`,
      type: "sync_failed" as const,
      title: `${q.voucherType} voucher refused — ${q.reference}`,
      message: q.lastError ?? "The finance system refused it",
      href: "/erp/accounting?status=Failed",
      at: q.queuedAt,
    })),
  ];

  // Stock has no event time — a shortfall is a standing condition, not an
  // event — so these follow the dated items, worst shortfall first.
  const standing: Array<Omit<AppNotification, "ago">> = data.spare_parts
    .filter((p) => p.onHand < p.reorderLevel)
    .sort((a, b) => a.onHand / a.reorderLevel - b.onHand / b.reorderLevel)
    .map((p) => ({
      id: `stock_low:${p.id}`,
      type: "stock_low" as const,
      title: `${p.name} below reorder level`,
      message: `${p.sku} · ${p.onHand} on hand, reorder at ${p.reorderLevel} · ${p.location}`,
      href: "/dms/inventory/spare-parts",
      at: new Date().toISOString(),
    }));

  return [
    ...items.sort((a, b) => +new Date(b.at) - +new Date(a.at)).map((item) => ({ ...item, ago: ago(now - new Date(item.at).getTime()) })),
    ...standing.map((item) => ({ ...item, ago: "Ongoing" })),
  ];
}

function ago(diff: number): string {
  if (diff < 0) return "today";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(diff / DAY);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function inr(value: number): string {
  if (Math.abs(value) >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)} Cr`;
  if (Math.abs(value) >= 100_000) return `₹${(value / 100_000).toFixed(2)} L`;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}
