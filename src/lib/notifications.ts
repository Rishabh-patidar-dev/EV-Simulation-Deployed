/**
 * The notification vocabulary, shared by the server (which derives
 * notifications from live data) and the client (bell menu and Settings).
 *
 * Notifications are not stored anywhere: each one is a row that currently
 * needs a human — an overdue invoice, an expired licence — so it appears the
 * moment the data says so and disappears once the row is dealt with. Only the
 * viewer's read marks and muted types are kept, in their own browser.
 */

export const NOTIFICATION_TYPES = [
  "lead_unassigned",
  "followup_overdue",
  "order_waiting",
  "order_late",
  "order_short",
  "invoice_overdue",
  "compliance_expired",
  "approval_pending",
  "claim_review",
  "stock_low",
  "ticket_breach",
  "loan_stalled",
  "delivery_overdue",
  "tp_expiring",
  "job_overdue",
  "sync_failed",
  "onboarding_stalled",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_META: Record<NotificationType, { label: string; description: string; module: string }> = {
  lead_unassigned: { label: "Unassigned leads", description: "New leads nobody owns yet.", module: "CRM" },
  followup_overdue: { label: "Overdue follow-ups", description: "Calls and visits past their due date.", module: "CRM" },
  order_waiting: { label: "Orders to acknowledge", description: "Dealer orders placed but not yet accepted.", module: "DMS" },
  order_short: { label: "Orders short of stock", description: "Dealer orders OEM stock could not cover, with no out-of-stock notice sent yet.", module: "DMS" },
  order_late: { label: "Late orders", description: "Orders past their expected date and still not with the dealer.", module: "DMS" },
  invoice_overdue: { label: "Overdue invoices", description: "Dealer invoices past their due date.", module: "DMS" },
  compliance_expired: { label: "Expired compliance", description: "Licences, GST and agreements that have lapsed.", module: "DMS" },
  approval_pending: { label: "Stale approvals", description: "Requests waiting more than two days for a decision.", module: "ERP" },
  claim_review: { label: "Claims under review", description: "Warranty claims awaiting adjudication.", module: "DMS" },
  stock_low: { label: "Low spare-part stock", description: "Parts below their reorder level.", module: "DMS" },
  ticket_breach: { label: "Tickets past SLA", description: "Open support tickets past their resolve-by time.", module: "CRM" },
  loan_stalled: { label: "Loans stuck with the lender", description: "Loan cases under review longer than the 72-hour sanction window.", module: "DMS" },
  delivery_overdue: { label: "Deliveries overdue", description: "Handovers past their scheduled date.", module: "DMS" },
  tp_expiring: { label: "Temporary registrations lapsing", description: "Vehicles whose TP lapses within a week, still unregistered.", module: "DMS" },
  job_overdue: { label: "Job cards past promise", description: "Vehicles in the workshop past the time promised to the customer.", module: "DMS" },
  onboarding_stalled: { label: "Stalled dealer applications", description: "Applications past their stage's time limit.", module: "DMS" },
  sync_failed: { label: "Accounting sync failures", description: "Vouchers the finance system refused — map the ledger and replay.", module: "ERP" },
};

export interface AppNotification {
  /** `${type}:${row id}` — stable for as long as the row needs attention. */
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  href: string;
  at: string;
  /** Relative time, rendered on the server so client and server agree. */
  ago: string;
}
