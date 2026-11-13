/**
 * Domain shapes for the simulation.
 *
 * These deliberately mirror the field names used by the production EV-CRM
 * Prisma schema (Lead, DealerApplication, Dealer, VehicleUnit, Invoice,
 * WarrantyClaim …) so that swapping the store from the simulation's own
 * `sim_*` Supabase tables to the real CRM tables is a query change, not a
 * rewrite of every screen.
 */

import type { UserRegion, UserRole, UserStatus } from "@/lib/permissions";

export type Money = number; // stored in whole rupees, formatted at the edge

export interface Lead {
  id: string;
  name: string;
  phone: string;
  city: string;
  /** The model the customer is interested in — drawn from VEHICLE_MODELS. */
  model: string;
  source: "Landing Page" | "WhatsApp" | "Walk-in" | "Referral" | "Dealer" | "Call Centre" | "Expo" | "Import";
  status: "New" | "Contacted" | "Qualified" | "Test Drive" | "Converted" | "Lost";
  assignedTo: string | null;
  dealer: string | null;
  score: number;
  value: Money;
  createdAt: string;
  updatedAt: string;
  nextAction: string;
  /** Set once this lead has been converted into a pipeline deal. */
  dealId: string | null;
  // Added with scoring, routing and import (EV-CRM's Lead). Older rows have none.
  email?: string | null;
  state?: string | null;
  pincode?: string | null;
  /** How the base score was worked out; `score` is this base plus engagement since. */
  scoreBreakdown?: { base: number; completeness: number; quality: number; missing: string[]; invalid: string[] } | null;
  /** How the lead reached its dealer. */
  routing?: { by: "Territory" | "Manual"; why: string | null; at: string } | null;
  /** Attribution, carried over from the enquiry that produced it. */
  landingPageId?: string | null;
  campaignId?: string | null;
}

/** A timestamped note against a lead — the CRM's activity trail. */
export interface LeadRemark {
  id: string;
  leadId: string;
  author: string;
  note: string;
  createdAt: string;
}

/**
 * A saved audience. `filter` is the live query — `size` is never stored,
 * it is computed against the current leads collection every time a segment
 * is read, so a segment's count is never allowed to go stale.
 */
export interface SegmentFilter {
  source?: Lead["source"];
  status?: Lead["status"];
  city?: string;
  minScore?: number;
}

export interface Segment {
  id: string;
  name: string;
  filter: SegmentFilter;
  channel: "Email" | "WhatsApp" | "SMS" | "Mixed";
  createdBy: string;
  updatedAt: string;
}

export interface Enquiry {
  id: string;
  reference: string;
  customer: string;
  phone: string;
  model: string;
  channel: "Landing Page" | "WhatsApp" | "Phone" | "Walk-in";
  dealer: string;
  status: "Open" | "Responded" | "Quoted" | "Closed";
  value: Money;
  createdAt: string;
  /** Set once this enquiry has been converted into a lead. */
  leadId: string | null;
  /** The landing page (and its campaign) that produced it. */
  landingPageId?: string | null;
  campaignId?: string | null;
  utmSource?: string | null;
  email?: string | null;
  city?: string | null;
}

export const DEAL_STAGES = ["Qualified", "Demo", "Quotation", "Negotiation", "Booked"] as const;

export interface Deal {
  id: string;
  /** The lead this deal was converted from, when it has one — set by
      convertLeadToDeal so a booking can be traced all the way back to the
      lead that started it. */
  leadId: string | null;
  customer: string;
  phone: string;
  dealer: string;
  model: string;
  stage: (typeof DEAL_STAGES)[number];
  value: Money;
  ageingDays: number;
  expectedClose: string;
  createdAt: string;
  /** Set once this deal has produced a booking (stage reaches "Booked"). */
  bookingId: string | null;
}

export const BOOKING_STAGES = ["Confirmed", "Awaiting Finance", "Ready for Delivery", "Delivered"] as const;

export interface Booking {
  id: string;
  bookingNo: string;
  /** The deal this booking was created from — the CRM/DMS handoff. */
  dealId: string | null;
  customer: string;
  dealer: string;
  model: string;
  token: Money;
  total: Money;
  status: "Confirmed" | "Awaiting Finance" | "Ready for Delivery" | "Delivered" | "Cancelled";
  bookedAt: string;
  deliveryEta: string;
  /** The vehicle unit allocated on delivery — the DMS side of the handoff. */
  vehicleUnitId: string | null;
  // Added with the delivery, finance and quotation modules. Optional so a row
  // stored before them still reads.
  /** Vehicles on this booking — fleet buyers book several at once. */
  quantity?: number;
  /** Price per vehicle, GST included. */
  unitPrice?: Money;
  phone?: string;
  /** The quotation this booking was converted from. */
  quotationId?: string | null;
}

export interface FollowUp {
  id: string;
  subject: string;
  relatedTo: string;
  customer: string;
  owner: string;
  channel: "Call" | "WhatsApp" | "Visit" | "Email";
  dueAt: string;
  status: "Due" | "Overdue" | "Done";
}

export interface Campaign {
  id: string;
  name: string;
  channel: "Email" | "WhatsApp" | "Landing Page" | "SMS";
  status: "Running" | "Scheduled" | "Completed" | "Paused";
  spend: Money;
  reached: number;
  responded: number;
  leads: number;
  startedAt: string;
  // Added with segment targeting and measured results (EV-CRM's MarketingCampaign). Older rows have none.
  segmentId?: string | null;
  /** The approved template a WhatsApp or SMS campaign goes out on. */
  template?: string | null;
  message?: string | null;
  /** For a landing-page campaign, the page it drives traffic to. */
  landingPageId?: string | null;
  sentAt?: string | null;
  /** Segment size when it was sent — the segment itself keeps changing. */
  audience?: number | null;
  /** Leads the send went to, so results can be measured against them. */
  audienceLeadIds?: string[];
}

export interface LandingPage {
  id: string;
  name: string;
  slug: string;
  status: "Live" | "Draft" | "Archived";
  views: number;
  submissions: number;
  updatedAt: string;
  // Added with attribution (EV-CRM's LandingPageCampaign). Older rows have none.
  /** Passed back by the external page with every submission, so it can be attributed. */
  uniqueId?: string | null;
  intent?: "Retail" | "Dealership" | "Both" | null;
  campaignId?: string | null;
  gtmContainerId?: string | null;
}

export interface Application {
  id: string;
  applicationNo: string;
  firm: string;
  city: string;
  state: string;
  intent: "Dealer" | "Distributor" | "Service Partner";
  stage: "Enquiry" | "Documents" | "Verification" | "Approval" | "Agreement";
  status: "In Progress" | "On Hold" | "Approved" | "Rejected";
  owner: string;
  submittedAt: string;

  // Added with the stage gates (EV-CRM's DealerApplication). Older rows have none.
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  pan?: string | null;
  investment?: string | null;
  source?: string | null;
  /** The documents each stage needs — seeded when the application enters the stage. */
  stageDocs?: Array<{
    key: string;
    label: string;
    stage: "Enquiry" | "Documents" | "Verification" | "Approval" | "Agreement";
    required: boolean;
    status: "Not Uploaded" | "Received" | "Verified" | "Rejected";
    note: string | null;
    at: string | null;
    by: string | null;
  }>;
  stageEnteredAt?: string | null;
  /** Why it is on hold or was rejected. */
  reason?: string | null;
  /** The Dealer Onboarding approval raised on entering Approval. */
  approvalId?: string | null;
  securityDeposit?: { amount: Money; reference: string; at: string } | null;
  /** The dealer created when the agreement was signed. */
  dealerId?: string | null;
  /** The landing page the application came in through. */
  landingPageId?: string | null;
  history?: WorkflowEvent[];
}

export interface KycDocument {
  id: string;
  applicationNo: string;
  firm: string;
  docType: "PAN" | "GST Certificate" | "Aadhaar" | "Trade Licence" | "Bank Proof" | "Premises Photo";
  status: "Verified" | "Pending" | "Rejected" | "Not Uploaded";
  uploadedAt: string | null;
  verifiedBy: string | null;
}

export interface Dealer {
  id: string;
  code: string;
  name: string;
  city: string;
  state: string;
  tier: "Platinum" | "Gold" | "Silver" | "Bronze";
  status: "Active" | "Onboarding" | "Suspended";
  ytdUnits: number;
  targetUnits: number;
  outstanding: Money;
  health: number;
  /** GST registration of the dealership — printed on every tax invoice it issues. */
  gstin?: string;
  /** Showroom photo or logo, resized to a square data URL by the picker. */
  logo?: string | null;
  /** Most the dealer may owe at once; null or absent means no limit is set. */
  creditLimit?: Money | null;
  /** Days to pay an invoice; absent means the default 30. */
  creditDays?: number | null;
  /** Held against the dealership agreement. */
  securityDeposit?: Money | null;
}

export interface ComplianceRecord {
  id: string;
  dealer: string;
  docType: "Trade Licence" | "GST Registration" | "Dealer Agreement" | "Fire NOC" | "Shop Insurance";
  reference: string;
  expiresOn: string;
  status: "Valid" | "Expiring Soon" | "Expired";
  // Added with renewals and reminders (EV-CRM's DealerComplianceRecord). Older rows have none.
  issuedOn?: string | null;
  notes?: string | null;
  /** Earlier references and expiries, newest last — a renewal keeps what it replaced. */
  renewals?: Array<{ reference: string; expiresOn: string; renewedAt: string; by: string }>;
  reminders?: Array<{ at: string; by: string; to: string; status: "Sent" | "Failed"; error: string | null }>;
}

export interface VehicleUnit {
  id: string;
  vin: string;
  model: string;
  variant: string;
  location: string;
  status: "In Stock" | "Allocated" | "In Transit" | "Delivered";
  ageingDays: number;
  price: Money;
  /** The booking this unit was allocated to for delivery. */
  bookingId?: string | null;
  /** The dealer order it arrived on. */
  orderId?: string | null;
  /** Written back by RTO & Registration once the RTO approves. */
  registrationNo?: string | null;
}

export interface SparePart {
  id: string;
  sku: string;
  name: string;
  category: "Battery" | "Motor" | "Controller" | "Body" | "Electrical" | "Consumable";
  onHand: number;
  reorderLevel: number;
  unitPrice: Money;
  location: string;
}

export interface InventoryLog {
  id: string;
  at: string;
  entity: "Vehicle" | "Spare Part";
  reference: string;
  direction: "IN" | "OUT";
  quantity: number;
  bucket: string;
  actor: string;
}

/** A dealer order moves through these in order; "Cancelled" can end it before dispatch. */
export const ORDER_FLOW = ["Placed", "Acknowledged", "In Production", "Dispatched", "Received"] as const;
export const ORDER_VARIANTS = ["Standard", "Deluxe", "Mega", "Super Deluxe"] as const;

export interface OrderLine {
  model: string;
  variant: (typeof ORDER_VARIANTS)[number];
  quantity: number;
  /** Dealer price per unit, before GST. */
  unitPrice: Money;
}

/** One step in an order's life — who moved it, when, and why if it was cancelled. */
export interface OrderEvent {
  /** A status the order reached, or a step along the way ("Stock checked", "Notice sent"). */
  status: string;
  at: string;
  by: string;
  note?: string;
}

export interface Order {
  id: string;
  orderNo: string;
  dealer: string;
  lineItems: number;
  units: number;
  /** Sum of the lines, before GST. */
  value: Money;
  /** "Stock Short" sits outside the flow: OEM stock could not cover it, and it waits on the short list. */
  status: (typeof ORDER_FLOW)[number] | "Stock Short" | "Cancelled";
  placedAt: string;
  expectedBy: string;
  // The fields below were added with order management. They are optional so a
  // row stored before them still reads — the screens say what is not recorded.
  lines?: OrderLine[];
  history?: OrderEvent[];
  placedBy?: string;
  /** Raised when the order is dispatched. */
  invoiceId?: string | null;
  cancelReason?: string;
  /** Set when the order would take the dealer past its credit limit — it waits for a Credit Limit approval. */
  creditHold?: { approvalId: string; exposure: Money; limit: Money } | null;
  /** The last check of the order against OEM stock (EV-CRM's Check Inventory). */
  stockCheck?: { at: string; by: string; sufficient: boolean; lines: Array<{ model: string; variant: string; requested: number; available: number }> } | null;
  /** The out-of-stock notice sent to the dealer while short. */
  notice?: { sentAt: string; by: string; expectedRestock: string | null; message: string | null; offeredUnits: number | null } | null;
  /** When the dealer took what was in stock, the rest became this back-order — or this order is that back-order. */
  backOrderId?: string | null;
  backOrderOf?: string | null;
}

export interface Invoice {
  id: string;
  invoiceNo: string;
  dealer: string;
  type: "Vehicle" | "Spare Part" | "Service";
  amount: Money;
  received: Money;
  status: "Paid" | "Part Paid" | "Unpaid" | "Overdue";
  issuedAt: string;
  dueOn: string;
  /** Each receipt against the invoice, oldest first. */
  payments?: InvoicePayment[];
  // Added with receivables (EV-CRM's finance module). Older rows have none.
  /** The dealer order it bills, when raised at dispatch. */
  orderId?: string | null;
  /** Reductions agreed after issue — a price correction, damage in transit. */
  creditNotes?: Array<{ no: string; amount: Money; reason: string; at: string; by: string }>;
  /** Payment reminders sent to the dealer. */
  reminders?: Array<{ at: string; by: string; to: string; status: "Sent" | "Failed"; error: string | null }>;
}

export interface InvoicePayment {
  at: string;
  amount: Money;
  mode: "NEFT/RTGS" | "UPI" | "Cheque" | "Payment Gateway";
  reference: string;
  by: string;
}

export interface WarrantyClaim {
  id: string;
  claimNo: string;
  dealer: string;
  vin: string;
  component: "Battery Pack" | "Motor" | "Controller" | "Charger" | "Harness";
  /**
   * Submitted → (Under Review | Info Requested) → Approved → In Repair →
   * Reimbursed → Recovery → Closed, or Rejected. "Recovered" is the end state
   * of claims from before supplier recovery cases existed.
   */
  status: "Submitted" | "Under Review" | "Info Requested" | "Approved" | "In Repair" | "Reimbursed" | "Recovery" | "Closed" | "Rejected" | "Recovered";
  claimedAmount: Money;
  raisedAt: string;
  /** Set when the claim was raised from a workshop job card. */
  jobCardId?: string | null;
  approvedAmount?: Money | null;
  /** Supplier debit note once the cost is recovered. */
  recoveryRef?: string | null;
  history?: WorkflowEvent[];

  // Added with claim intake and adjudication (EV-CRM's WarrantyClaim). Older
  // rows have none of these — every screen reads them as optional.
  model?: string | null;
  customer?: string | null;
  customerPhone?: string | null;
  /** The symptom, in the dealer's words. */
  issue?: string | null;
  /** Evidence the rules run against. */
  odometerKm?: number | null;
  measuredSohPct?: number | null;
  chargerType?: string | null;
  serviceRecordsComplete?: boolean | null;
  /** Where the odometer and SoH came from — typed in, or read off the vehicle's telematics unit. */
  evidenceSource?: "Dealer" | "Telematics" | "Job card" | null;
  /** When cover started (the handover) — null when the chassis is not on the road in this network. */
  coverStartedAt?: string | null;
  adjudication?: { decision: "Auto-approve" | "Needs review" | "Void"; reasons: string[]; at: string } | null;
  rejectionReason?: string | null;
  /** What the OEM asked the dealer for, while Info Requested. */
  infoRequest?: string | null;
  partReturned?: boolean;
  partReturnedAt?: string | null;
  /** The credit note that reimbursed the dealer. */
  creditNoteNo?: string | null;
  reimbursedAt?: string | null;
  recovery?: {
    supplier: string;
    amount: Money;
    status: "Open" | "Recovered" | "Written Off";
    debitNote: string | null;
    notes: string | null;
    openedAt: string;
    closedAt: string | null;
  } | null;
  resolvedAt?: string | null;
}

export interface DocumentRecord {
  id: string;
  name: string;
  kind: "KYC" | "Agreement" | "Invoice" | "Compliance" | "Claim";
  linkedTo: string;
  owner: string;
  sizeKb: number;
  uploadedAt: string;
  status: "Verified" | "Pending" | "Archived";
}

export interface RoleRecord {
  id: string;
  role: string;
  users: number;
  scope: string;
  modules: number;
  canApprove: string;
}

export interface Approval {
  id: string;
  type: "Discount" | "Credit Limit" | "Dealer Onboarding" | "Warranty Claim" | "Purchase Order";
  subject: string;
  requestedBy: string;
  pendingWith: string;
  raisedAt: string;
  /** Hours waiting when the row was stored — read `raisedAt` for the live figure. */
  ageingHours: number;
  // Added with approval decisions. A row without a status is still pending.
  status?: "Pending" | "Approved" | "Rejected";
  decidedBy?: string | null;
  decidedAt?: string | null;
  note?: string | null;
  /** The record the decision applies to, when approving it changes something. */
  link?: { kind: "quotation" | "warranty_claim" | "order" | "application"; id: string } | null;
  /** What is being asked for, in words — "6.5% off 12 × Queen EV". */
  detail?: string | null;
}

/**
 * Someone with access to the platform. `permissions` only matters when the
 * role is "Custom" — every other role takes its preset (see lib/permissions).
 */
export interface AppUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  region: UserRegion;
  /** Set for dealer-side users — the dealership they belong to. */
  dealer: string | null;
  status: UserStatus;
  permissions: string[];
  /** Null until the invitation is accepted and the user first signs in. */
  lastActiveAt: string | null;
  invitedAt: string;
  createdAt: string;
}

/** One step in a record's life — who moved it, when, and why. */
export interface WorkflowEvent {
  status: string;
  at: string;
  by: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Product catalogue & price list (Quotation & GST Invoicing)
// ---------------------------------------------------------------------------

export const BODY_TYPES = ["Passenger", "Cargo", "Delivery", "Garbage", "Mobile Business"] as const;

/** How the RTO classes the vehicle — decides the registration paperwork and the PM E-DRIVE window. */
export const RTO_CLASSES = ["e-Rickshaw", "e-Cart", "L5 Passenger", "L5 Goods"] as const;

export interface VariantPrice {
  variant: (typeof ORDER_VARIANTS)[number];
  /** Customer ex-showroom price per vehicle, GST included. */
  exShowroom: Money;
  /** OEM → dealer price per vehicle, before GST. */
  dealerPrice: Money;
  /** Battery energy — what the PM E-DRIVE incentive is computed on. */
  batteryKwh: number;
}

export interface Product {
  id: string;
  /** One of VEHICLE_MODELS — the name every other module uses. */
  model: string;
  segment: "L3" | "L5";
  bodyType: (typeof BODY_TYPES)[number];
  rtoClass: (typeof RTO_CLASSES)[number];
  /** 6-digit HSN printed on tax invoices: 870380 passenger, 870460 goods. */
  hsn: string;
  motor: string;
  battery: string;
  range: string;
  capacity: string;
  warranty: string;
  /** Eligible for the PM E-DRIVE e-rickshaw / e-cart incentive. */
  subsidyEligible: boolean;
  variants: VariantPrice[];
  active: boolean;
  updatedAt: string;
}

export const QUOTE_LINE_KINDS = ["Vehicle", "Accessory", "Extended Warranty", "Registration & HSRP", "Insurance"] as const;

export interface QuoteLine {
  kind: (typeof QUOTE_LINE_KINDS)[number];
  description: string;
  model?: string;
  variant?: (typeof ORDER_VARIANTS)[number];
  /** HSN for goods, SAC for services. */
  hsn: string;
  quantity: number;
  /** Taxable value per unit, before GST. */
  unitPrice: Money;
  /** 5 for vehicles, 18 for accessories and services, 0 for amounts collected on someone else's behalf. */
  gstRate: number;
}

export const QUOTE_STATUSES = ["Draft", "Pending Approval", "Sent", "Accepted", "Converted", "Rejected", "Expired"] as const;

export interface Quotation {
  id: string;
  quoteNo: string;
  dealer: string;
  /** The dealer's state — the other half of the CGST/SGST-or-IGST decision. */
  dealerState: string;
  customer: string;
  phone: string;
  /** Present for a business buyer — makes the invoice B2B, with an IRN. */
  customerGstin: string | null;
  /** Place of supply: decides CGST + SGST against IGST. */
  customerState: string;
  dealId: string | null;
  leadId: string | null;
  lines: QuoteLine[];
  /** Off the vehicle lines, before GST. */
  discount: Money;
  /** PM E-DRIVE incentive deducted from what the buyer pays. */
  subsidy: Money;
  status: (typeof QUOTE_STATUSES)[number];
  approvalId: string | null;
  bookingId: string | null;
  validUntil: string;
  createdAt: string;
  createdBy: string;
  history: WorkflowEvent[];
}

/** A dealer → customer GST tax invoice: a vehicle sale at delivery, or a workshop bill. */
export interface TaxInvoice {
  id: string;
  invoiceNo: string;
  kind: "Vehicle Sale" | "Service";
  dealer: string;
  dealerGstin: string;
  dealerState: string;
  customer: string;
  customerGstin: string | null;
  placeOfSupply: string;
  quotationId: string | null;
  bookingId: string | null;
  jobCardId: string | null;
  lines: QuoteLine[];
  discount: Money;
  subsidy: Money;
  // Totals are fixed when the invoice is issued, so it never changes afterwards.
  taxable: Money;
  cgst: Money;
  sgst: Money;
  igst: Money;
  total: Money;
  /** Total less the PM E-DRIVE incentive — what the buyer pays. */
  payable: Money;
  /** e-invoice reference from the IRP — B2B invoices only. */
  irn: string | null;
  ackNo: string | null;
  ackAt: string | null;
  ewayBillNo: string | null;
  vins: string[];
  issuedAt: string;
  status: "Issued" | "Cancelled";
  cancelReason: string | null;
}

// ---------------------------------------------------------------------------
// Test drives
// ---------------------------------------------------------------------------

export const TEST_DRIVE_STATUSES = ["Scheduled", "Checked In", "Completed", "No Show", "Cancelled"] as const;

export interface TestDrive {
  id: string;
  driveNo: string;
  leadId: string | null;
  customer: string;
  phone: string;
  model: string;
  dealer: string;
  slotAt: string;
  durationMin: number;
  status: (typeof TEST_DRIVE_STATUSES)[number];
  bookedVia: "Dealer" | "Landing Page" | "Call Centre" | "WhatsApp";
  /** Driving licence number, checked before the keys are handed over. */
  licenceNo: string | null;
  licenceVerified: boolean;
  feedback: { rating: number; interest: "Hot" | "Warm" | "Cold"; comments: string } | null;
  createdAt: string;
  createdBy: string;
  completedAt: string | null;
  cancelReason: string | null;
}

// ---------------------------------------------------------------------------
// Customer support
// ---------------------------------------------------------------------------

/** The categories on luxusgreen.com's support form. */
export const TICKET_CATEGORIES = [
  "Service Support",
  "Warranty Support",
  "Spare Parts",
  "Dealer Assistance",
  "Product Enquiry",
  "Business Support",
  "General Enquiry",
] as const;
export const TICKET_PRIORITIES = ["P1", "P2", "P3", "P4"] as const;
export const TICKET_STATUSES = ["Open", "In Progress", "Awaiting Customer", "Escalated", "Resolved", "Closed"] as const;
export const TICKET_CHANNELS = ["Phone", "WhatsApp", "Email", "Web Form"] as const;

export interface TicketMessage {
  at: string;
  by: string;
  kind: "Customer" | "Agent" | "Internal" | "System";
  text: string;
}

export interface SupportTicket {
  id: string;
  ticketNo: string;
  customer: string;
  phone: string;
  city: string;
  channel: (typeof TICKET_CHANNELS)[number];
  category: (typeof TICKET_CATEGORIES)[number];
  priority: (typeof TICKET_PRIORITIES)[number];
  subject: string;
  model: string | null;
  vin: string | null;
  dealer: string | null;
  claimId: string | null;
  status: (typeof TICKET_STATUSES)[number];
  assignee: string;
  escalatedTo: string | null;
  openedAt: string;
  /** SLA targets, fixed from the priority when the ticket is opened. */
  respondBy: string;
  resolveBy: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  /** 1–5, asked for once the ticket is resolved. */
  csat: number | null;
  thread: TicketMessage[];
}

// ---------------------------------------------------------------------------
// Finance & insurance
// ---------------------------------------------------------------------------

/** A lender on the dealer panel. */
export interface Financier {
  id: string;
  name: string;
  kind: "NBFC" | "Bank";
  /** Lowest rate offered, % a year. */
  rateFrom: number;
  maxTenure: number;
  minDownPct: number;
  processingFeePct: number;
  /** Paid to the dealer on each disbursed loan, % of the loan amount. */
  payoutPct: number;
  active: boolean;
}

/** What luxusgreen.com lists as needed for a vehicle loan. */
export const LOAN_DOCUMENTS = [
  "Aadhaar",
  "PAN",
  "Driving Licence",
  "Income Proof",
  "Bank Statement (6 months)",
  "Booking Form",
  "Proforma Invoice",
  "Photographs",
] as const;
export const LOAN_FLOW = ["Applied", "Under Review", "Sanctioned", "Disbursed"] as const;

export interface FinanceCase {
  id: string;
  caseNo: string;
  bookingId: string;
  bookingNo: string;
  customer: string;
  dealer: string;
  model: string;
  quantity: number;
  financierId: string;
  financier: string;
  vehicleValue: Money;
  downPayment: Money;
  loanAmount: Money;
  ratePct: number;
  tenureMonths: number;
  emi: Money;
  processingFee: Money;
  documents: Array<{ name: (typeof LOAN_DOCUMENTS)[number]; received: boolean }>;
  cibil: number | null;
  status: (typeof LOAN_FLOW)[number] | "Rejected" | "Withdrawn";
  sanctionRef: string | null;
  utr: string | null;
  appliedAt: string;
  sanctionedAt: string | null;
  disbursedAt: string | null;
  /** The dealer's payout from the financier on this loan. */
  payout: { amount: Money; status: "Pending" | "Accrued" | "Received"; receivedAt: string | null; reference: string | null };
  history: WorkflowEvent[];
}

export const INSURERS = ["ICICI Lombard", "Bajaj Allianz", "TATA AIG", "HDFC ERGO", "New India Assurance", "Go Digit"] as const;

/** A motor policy on one vehicle — insurance is per chassis. */
export interface InsurancePolicy {
  id: string;
  policyNo: string;
  bookingId: string;
  vehicleUnitId: string | null;
  vin: string | null;
  customer: string;
  dealer: string;
  model: string;
  insurer: (typeof INSURERS)[number];
  cover: "Comprehensive" | "Third Party Only";
  idv: Money;
  odPremium: Money;
  tpPremium: Money;
  gst: Money;
  premium: Money;
  commissionPct: number;
  commission: Money;
  commissionStatus: "Accrued" | "Received";
  startsOn: string;
  endsOn: string;
  status: "Issued" | "Cancelled";
  issuedAt: string;
}

// ---------------------------------------------------------------------------
// Vehicle delivery
// ---------------------------------------------------------------------------

/** The pre-delivery inspection, signed off per chassis. */
export const PDI_CHECKS = [
  "Battery charged to 90% or more",
  "Charger and cable present and working",
  "Motor and controller — no fault codes",
  "Brakes, front and rear",
  "Lights, indicators and horn",
  "Tyres and pressures",
  "Instrument cluster",
  "Body, paint and CED finish",
  "Chassis and motor numbers match Form 22",
  "Toolkit, owner's manual and warranty card",
] as const;

export interface DeliveryVehicle {
  vehicleUnitId: string;
  vin: string;
  variant: string;
  /** One entry per PDI_CHECKS item. */
  pdi: boolean[];
  pdiBy: string | null;
  pdiAt: string | null;
}

export const DELIVERY_FLOW = ["Scheduled", "PDI Done", "Dispatched", "Handed Over"] as const;

export interface Delivery {
  id: string;
  deliveryNo: string;
  bookingId: string;
  bookingNo: string;
  customer: string;
  phone: string;
  dealer: string;
  model: string;
  quantity: number;
  vehicles: DeliveryVehicle[];
  scheduledFor: string;
  gatePassNo: string | null;
  ewayBillNo: string | null;
  dispatchedAt: string | null;
  /** Sent to the customer at dispatch; confirms the handover. */
  handoverOtp: string | null;
  handover: { at: string; acknowledgedBy: string; odometerKm: number; photoRef: string } | null;
  status: (typeof DELIVERY_FLOW)[number] | "Cancelled";
  taxInvoiceId: string | null;
  createdAt: string;
  history: WorkflowEvent[];
}

// ---------------------------------------------------------------------------
// RTO & registration
// ---------------------------------------------------------------------------

export const RTO_FLOW = ["TP Issued", "Documents Ready", "Submitted", "Approved", "RC Issued"] as const;
export const RTO_DOCUMENTS = ["Form 20", "Form 21", "Form 22", "Insurance", "Tax Invoice", "Address Proof"] as const;

export interface Registration {
  id: string;
  appNo: string;
  bookingId: string;
  deliveryId: string | null;
  vehicleUnitId: string;
  vin: string;
  model: string;
  customer: string;
  dealer: string;
  state: string;
  rtoOffice: string;
  vehicleClass: (typeof RTO_CLASSES)[number];
  /** Temporary registration issued at delivery. */
  tpNo: string;
  tpIssuedAt: string;
  tpValidUntil: string;
  documents: Array<{ name: (typeof RTO_DOCUMENTS)[number]; ready: boolean }>;
  vahanAppNo: string | null;
  submittedAt: string | null;
  status: (typeof RTO_FLOW)[number] | "Objection";
  objection: string | null;
  registrationNo: string | null;
  approvedAt: string | null;
  hsrpFittedAt: string | null;
  rcIssuedAt: string | null;
  fees: { registration: Money; roadTax: Money; hsrp: Money };
  history: WorkflowEvent[];
}

// ---------------------------------------------------------------------------
// Service job cards
// ---------------------------------------------------------------------------

export const JOB_BILL_TO = ["Customer", "Free Service", "Warranty"] as const;
export const JOB_TYPES = ["Free Service", "Paid Service", "Warranty Repair", "Running Repair"] as const;
export const JOB_FLOW = ["Open", "In Progress", "Ready", "Closed"] as const;

export interface JobComplaint {
  complaint: string;
  cause: string;
  correction: string;
}

export interface JobLabour {
  description: string;
  hours: number;
  rate: Money;
  billTo: (typeof JOB_BILL_TO)[number];
}

export interface JobPart {
  partId: string;
  sku: string;
  name: string;
  hsn: string;
  quantity: number;
  unitPrice: Money;
  billTo: (typeof JOB_BILL_TO)[number];
}

export interface JobCard {
  id: string;
  jobNo: string;
  dealer: string;
  customer: string;
  phone: string;
  vin: string;
  model: string;
  registrationNo: string | null;
  odometerKm: number;
  serviceType: (typeof JOB_TYPES)[number];
  /** Which free service this is, for a Free Service card. */
  freeServiceNo: number | null;
  complaints: JobComplaint[];
  technician: string;
  labour: JobLabour[];
  parts: JobPart[];
  status: (typeof JOB_FLOW)[number] | "Awaiting Parts" | "Cancelled";
  openedAt: string;
  promisedAt: string;
  closedAt: string | null;
  warrantyClaimId: string | null;
  taxInvoiceId: string | null;
  nextServiceAt: string | null;
  nextServiceKm: number | null;
  history: WorkflowEvent[];
}

// ---------------------------------------------------------------------------
// ERP / accounting integration
// ---------------------------------------------------------------------------

export const LEDGER_KEYS = [
  "sales_vehicle",
  "sales_parts",
  "sales_service",
  "output_cgst",
  "output_sgst",
  "output_igst",
  "debtors_dealers",
  "debtors_retail",
  "bank",
  "finance_payout_income",
  "insurance_commission_income",
  // Added with warranty reimbursement — what the OEM bears until the supplier pays it back.
  "warranty_expense",
] as const;
export type LedgerKey = (typeof LEDGER_KEYS)[number];

/** Where one of the app's accounts lands in the finance system's chart of accounts. */
export interface LedgerMapping {
  id: string;
  key: LedgerKey;
  label: string;
  group: "Sales Accounts" | "Duties & Taxes" | "Sundry Debtors" | "Bank Accounts" | "Indirect Incomes" | "Direct Expenses";
  /** Null until someone maps it — a voucher needing it fails to sync. */
  ledgerName: string | null;
  costCentre: string | null;
  updatedAt: string;
}

export interface SyncItem {
  id: string;
  voucherType: "Sales" | "Receipt" | "Credit Note";
  source: "Dealer Invoice" | "Retail Invoice" | "Dealer Payment" | "Finance Payout" | "Insurance Commission" | "Warranty Claim" | "Dealer Credit Note";
  sourceId: string;
  reference: string;
  party: string;
  amount: Money;
  /** The mapped accounts the voucher posts to. */
  ledgers: LedgerKey[];
  status: "Queued" | "Synced" | "Failed";
  attempts: number;
  lastError: string | null;
  /** The voucher's number in the finance system once posted. */
  externalRef: string | null;
  queuedAt: string;
  syncedAt: string | null;
}

// ---------------------------------------------------------------------------
// API integrations
// ---------------------------------------------------------------------------

export const CONNECTOR_KEYS = ["whatsapp", "sms", "payments", "telematics", "accounting", "vahan", "gst_irp", "eway_bill", "ticketing"] as const;

/** An external system the platform talks to. Credentials are never stored here — only whether they are set. */
export interface Connector {
  id: string;
  key: (typeof CONNECTOR_KEYS)[number];
  name: string;
  provider: string;
  category: "Messaging" | "Payments" | "Telematics" | "Accounting" | "Government" | "Support";
  status: "Connected" | "Disconnected" | "Error";
  environment: "Sandbox" | "Production";
  /** Non-secret settings: sender ID, business number, company name. */
  config: Record<string, string>;
  credentialsSet: boolean;
  lastEventAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface Message {
  id: string;
  channel: "WhatsApp" | "SMS";
  to: string;
  customer: string;
  templateId: string | null;
  template: string;
  body: string;
  status: "Queued" | "Sent" | "Delivered" | "Read" | "Failed";
  error: string | null;
  related: { kind: string; id: string; label: string } | null;
  at: string;
}

/** A pre-approved message: a WhatsApp template, or an SMS content template on the DLT registry. */
export interface MessageTemplate {
  id: string;
  channel: "WhatsApp" | "SMS";
  name: string;
  category: "Utility" | "Marketing" | "Authentication" | "Transactional" | "Service Implicit" | "Promotional";
  /** SMS only: the 6-character DLT header. */
  senderId: string | null;
  /** SMS only: the 19-digit DLT content template ID. */
  dltTemplateId: string | null;
  body: string;
  status: "Approved" | "Pending" | "Rejected";
  updatedAt: string;
}

export interface Payment {
  id: string;
  gatewayRef: string;
  purpose: "Booking Token" | "Dealer Invoice" | "Service Invoice";
  payer: string;
  amount: Money;
  method: "UPI" | "Card" | "Net Banking";
  status: "Created" | "Captured" | "Failed" | "Refunded";
  /** Gateway charges, deducted at settlement. */
  fee: Money;
  related: { kind: string; id: string; label: string } | null;
  createdAt: string;
  capturedAt: string | null;
  settledAt: string | null;
}

/** The IoT unit on a delivered vehicle and its latest reading. */
export interface TelematicsDevice {
  id: string;
  imei: string;
  vin: string;
  model: string;
  customer: string;
  dealer: string;
  activatedAt: string;
  /** Battery state of charge, %. */
  soc: number;
  /** Battery state of health, %. */
  soh: number;
  odometerKm: number;
  city: string;
  lastSeenAt: string;
  status: "Online" | "Offline";
  alerts: string[];
}

/**
 * A dealer's order for spare parts against the OEM's parts stock — EV-CRM's
 * SparePartRequest. Requested → (stock check) Confirmed or Short → Dispatched
 * (with its GST invoice) → Delivered; cancellable before dispatch.
 */
export const PART_ORDER_FLOW = ["Requested", "Confirmed", "Dispatched", "Delivered"] as const;

export interface PartOrder {
  id: string;
  orderNo: string;
  dealer: string;
  lines: Array<{ partId: string; sku: string; name: string; quantity: number; unitPrice: Money }>;
  /** Before GST. */
  value: Money;
  status: (typeof PART_ORDER_FLOW)[number] | "Short" | "Cancelled";
  placedAt: string;
  /** The last stock check, line by line. */
  stockCheck: { at: string; lines: Array<{ sku: string; requested: number; available: number }> } | null;
  notice: { sentAt: string; expectedRestock: string | null; message: string | null } | null;
  backOrderOf: string | null;
  backOrderId: string | null;
  invoiceId: string | null;
  cancelReason: string | null;
  history: WorkflowEvent[];
}

/** Every collection the store can serve, keyed by its `sim_*` table name. */
export interface Dataset {
  leads: Lead[];
  lead_remarks: LeadRemark[];
  segments: Segment[];
  enquiries: Enquiry[];
  deals: Deal[];
  bookings: Booking[];
  follow_ups: FollowUp[];
  campaigns: Campaign[];
  landing_pages: LandingPage[];
  applications: Application[];
  kyc_documents: KycDocument[];
  dealers: Dealer[];
  compliance: ComplianceRecord[];
  vehicle_units: VehicleUnit[];
  spare_parts: SparePart[];
  inventory_logs: InventoryLog[];
  orders: Order[];
  invoices: Invoice[];
  warranty_claims: WarrantyClaim[];
  documents: DocumentRecord[];
  roles: RoleRecord[];
  approvals: Approval[];
  users: AppUser[];
  products: Product[];
  quotations: Quotation[];
  tax_invoices: TaxInvoice[];
  test_drives: TestDrive[];
  tickets: SupportTicket[];
  financiers: Financier[];
  finance_cases: FinanceCase[];
  insurance_policies: InsurancePolicy[];
  deliveries: Delivery[];
  registrations: Registration[];
  job_cards: JobCard[];
  ledger_mappings: LedgerMapping[];
  sync_queue: SyncItem[];
  connectors: Connector[];
  messages: Message[];
  message_templates: MessageTemplate[];
  payments: Payment[];
  telematics: TelematicsDevice[];
  part_orders: PartOrder[];
}

export type CollectionName = keyof Dataset;

/** Keyed by CollectionName, so a collection added to Dataset and not here is a type error. */
const COLLECTION_KEYS: Record<CollectionName, true> = {
  leads: true,
  lead_remarks: true,
  segments: true,
  enquiries: true,
  deals: true,
  bookings: true,
  follow_ups: true,
  campaigns: true,
  landing_pages: true,
  applications: true,
  kyc_documents: true,
  dealers: true,
  compliance: true,
  vehicle_units: true,
  spare_parts: true,
  inventory_logs: true,
  orders: true,
  invoices: true,
  warranty_claims: true,
  documents: true,
  roles: true,
  approvals: true,
  users: true,
  products: true,
  quotations: true,
  tax_invoices: true,
  test_drives: true,
  tickets: true,
  financiers: true,
  finance_cases: true,
  insurance_policies: true,
  deliveries: true,
  registrations: true,
  job_cards: true,
  ledger_mappings: true,
  sync_queue: true,
  connectors: true,
  messages: true,
  message_templates: true,
  payments: true,
  telematics: true,
  part_orders: true,
};

/** Every collection, one `sim_*` table each (supabase/schema.sql). */
export const COLLECTIONS = Object.keys(COLLECTION_KEYS) as CollectionName[];
