/**
 * The single source of truth for this simulation's module map.
 *
 * The client handed over a flat module list split three ways — CRM, DMS and
 * ERP. Everything they listed lives in ONE dashboard here (that is the whole
 * point of the simulation: the existing EV-CRM / Ev Landing / DMS apps are
 * three separate deployments talking to each other over HTTP, and this shows
 * the same journey without the seams). So the nav below mirrors their list
 * section for section, and the sidebar renders it as-is.
 */

export interface ModuleLeaf {
  /** Route path, also the key used to look the module up. */
  href: string;
  label: string;
  /** lucide-react icon name, resolved in the sidebar. */
  icon: string;
  /** Shown on the module page header. */
  blurb: string;
  /**
   * Still to be wired to its live API — the screen works on simulated data.
   * Carries a red dot in the rail and a marker on the screen, so nobody demos
   * it as finished.
   */
  underDevelopment?: true;
}

export interface ModuleGroup {
  id: string;
  label: string;
  icon: string;
  children: ModuleLeaf[];
}

type NavNode = ({ kind: "leaf" } & ModuleLeaf) | ({ kind: "group" } & ModuleGroup);

interface NavSection {
  id: string;
  /** Uppercase rail heading — "CUSTOMER RELATIONSHIP MANAGEMENT" etc. */
  label: string;
  nodes: NavNode[];
}

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

const CRM: NavSection = {
  id: "crm",
  label: "Customer Relationship Management",
  nodes: [
    {
      kind: "group",
      id: "leads",
      label: "Lead Capture & Tracking",
      icon: "Users",
      children: [
        { href: "/crm/leads", label: "Lead Master", icon: "UserSquare2", blurb: "Every lead the network has captured, from any source, in one register." },
        { href: "/crm/leads/unassigned", label: "Unassigned Leads", icon: "Share2", blurb: "Captured but not yet routed to a dealer or a salesperson." },
        { href: "/crm/leads/assigned", label: "Assigned Leads", icon: "UserCheck", blurb: "Leads with an owner — tracked against response time and next action." },
        { href: "/crm/leads/segments", label: "Segments", icon: "CheckSquare", blurb: "Saved audience definitions used to target campaigns and follow-ups." },
      ],
    },
    { kind: "leaf", href: "/crm/enquiries", label: "Enquiry Management", icon: "MessageSquare", blurb: "Inbound product and price enquiries from the landing page, calls and walk-ins." },
    { kind: "leaf", href: "/crm/test-drives", label: "Test Drive Scheduling", icon: "CalendarClock", blurb: "Demo-vehicle slots per dealer, licence checks before the keys, and feedback back onto the lead." },
    {
      kind: "group",
      id: "pipeline",
      label: "Sales Pipeline & Booking",
      icon: "TrendingUp",
      children: [
        { href: "/crm/pipeline", label: "Pipeline Board", icon: "Kanban", blurb: "Deals by stage, with value and ageing, across the dealer network." },
        { href: "/crm/bookings", label: "Bookings", icon: "ClipboardCheck", blurb: "Confirmed customer bookings with token amounts and delivery expectations." },
      ],
    },
    { kind: "leaf", href: "/crm/follow-ups", label: "Customer Follow-ups", icon: "PhoneCall", blurb: "Scheduled calls, visits and reminders against leads, bookings and service." },
    {
      kind: "group",
      id: "campaigns",
      label: "Marketing Campaigns",
      icon: "Megaphone",
      children: [
        { href: "/crm/campaigns", label: "Campaign Master", icon: "Megaphone", blurb: "Every email, WhatsApp and landing-page campaign with spend and response." },
        { href: "/crm/campaigns/landing-pages", label: "Landing Pages", icon: "LayoutTemplate", blurb: "Public capture pages, their traffic and the leads they produced." },
      ],
    },
    { kind: "leaf", href: "/crm/support", label: "Customer Support & Ticketing", icon: "LifeBuoy", blurb: "Complaints and queries from every channel, worked against priority SLAs, escalated to the RM, closed with CSAT.", underDevelopment: true },
  ],
};

// ---------------------------------------------------------------------------
// DMS
// ---------------------------------------------------------------------------

const DMS: NavSection = {
  id: "dms",
  label: "Dealer Management System",
  nodes: [
    {
      kind: "group",
      id: "onboarding",
      label: "Dealer Onboarding",
      icon: "Workflow",
      children: [
        { href: "/dms/onboarding", label: "Onboarding Pipeline", icon: "Workflow", blurb: "Applications moving stage by stage from enquiry to signed agreement." },
        { href: "/dms/onboarding/kyc", label: "Digital KYC & Verification", icon: "ScanLine", blurb: "Document-by-document KYC status for every application in the pipeline." },
      ],
    },
    {
      kind: "group",
      id: "dealers",
      label: "Dealer Management",
      icon: "Building2",
      children: [
        { href: "/dms/dealers", label: "Dealer 360", icon: "Building2", blurb: "The live dealer network — tier, territory, targets and account health." },
        { href: "/dms/dealers/compliance", label: "Compliance & Renewals", icon: "ShieldCheck", blurb: "Trade licences, GST, agreements and insurance, with expiry tracking." },
      ],
    },
    {
      kind: "group",
      id: "inventory",
      label: "Vehicle Inventory",
      icon: "Warehouse",
      children: [
        { href: "/dms/inventory/vehicles", label: "Vehicle Stock", icon: "Car", blurb: "Unit-level vehicle stock by model, location and status." },
        { href: "/dms/inventory/spare-parts", label: "Spare Parts Inventory", icon: "PackageSearch", blurb: "Spare part stock, reorder levels and consumption across the network." },
        { href: "/dms/inventory/logs", label: "Inventory Logs", icon: "ScrollText", blurb: "Every inward and outward stock movement, with its source document." },
      ],
    },
    { kind: "leaf", href: "/dms/quotations", label: "Quotation & GST Invoicing", icon: "FileSpreadsheet", blurb: "Quotations off the price list, taxed by place of supply, converting to bookings and GST tax invoices.", underDevelopment: true },
    {
      kind: "group",
      id: "orders",
      label: "Booking, Billing & Delivery",
      icon: "ListChecks",
      children: [
        { href: "/dms/orders", label: "Order Management", icon: "ShoppingCart", blurb: "Dealer orders from placement to receipt — lines, fulfilment, dispatch and the invoice it raises." },
        { href: "/dms/orders/invoices", label: "Billing & Invoices", icon: "Receipt", blurb: "Dealer invoices and receivables — ageing, statements, credit limits and holds, receipts, credit notes and reminders." },
        { href: "/dms/orders/delivery", label: "Vehicle Delivery", icon: "Truck", blurb: "Allocation, PDI per chassis, gate pass and e-way bill, and OTP-confirmed customer handover." },
      ],
    },
    { kind: "leaf", href: "/dms/finance-insurance", label: "Finance & Insurance (F&I)", icon: "Landmark", blurb: "Loans with the NBFC panel from application to disbursal, insurance per chassis, and the dealer's payouts." },
    { kind: "leaf", href: "/dms/rto", label: "RTO & Registration (TP)", icon: "BadgeCheck", blurb: "Temporary registration at handover, the Form 20/21/22 file, Vahan filing and the registration number.", underDevelopment: true },
    {
      kind: "group",
      id: "aftersales",
      label: "Service & Warranty",
      icon: "Wrench",
      children: [
        { href: "/dms/service/warranty", label: "Warranty Claims", icon: "ShieldPlus", blurb: "Component-level warranty claims, adjudication and supplier recovery." },
        { href: "/dms/service/jobcards", label: "Service Job Cards", icon: "Wrench", blurb: "Workshop job cards — complaint, cause, correction, parts off stock — billed, claimed and scheduled." },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// ERP & core integrations
// ---------------------------------------------------------------------------

const ERP: NavSection = {
  id: "erp",
  label: "ERP & Core Integrations",
  nodes: [
    { kind: "leaf", href: "/erp/documents", label: "Document Management", icon: "FolderOpen", blurb: "Every KYC file, agreement and invoice in the system, in one register." },
    { kind: "leaf", href: "/erp/access", label: "Role-Based Access & Approvals", icon: "KeyRound", blurb: "Who can see what, and which approvals are waiting on whom." },
    { kind: "leaf", href: "/erp/analytics", label: "Dashboards, MIS & Analytics", icon: "BarChart3", blurb: "Network-level MIS — sales, stock, collections and service in one view." },
    { kind: "leaf", href: "/erp/accounting", label: "ERP / Accounting Integration", icon: "Calculator", blurb: "Every invoice, receipt and payout posted to the finance system, with ledger mapping, replay and reconciliation." },
    { kind: "leaf", href: "/erp/integrations", label: "API Integrations", icon: "Plug", blurb: "WhatsApp, DLT SMS, payment gateway, telematics, Vahan, GST IRP and e-way bill connectors and their traffic." },
  ],
};

export const NAV_SECTIONS: NavSection[] = [CRM, DMS, ERP];

/**
 * Workspace administration. Not on the client's module list, so it is kept
 * out of NAV_SECTIONS and therefore out of ALL_MODULES.
 */
const ADMIN_SECTION: NavSection = {
  id: "admin",
  label: "Administration",
  nodes: [
    { kind: "leaf", href: "/admin/notifications", label: "Notifications", icon: "Bell", blurb: "Everything across CRM, DMS and ERP that needs a decision — read, filter and choose what reaches the bell." },
    { kind: "leaf", href: "/admin/users", label: "User Management", icon: "UserCog", blurb: "Everyone with access to the platform — role, territory, status and exactly what they can reach." },
    { kind: "leaf", href: "/settings", label: "Settings", icon: "Settings", blurb: "Your profile, notification preferences, and where this workspace reads its data." },
  ],
};

/** Every section the rail renders: the client's list first, administration last. */
export const RAIL_SECTIONS: NavSection[] = [...NAV_SECTIONS, ADMIN_SECTION];

/** Everywhere a page can be looked up from. */
const LOOKUP_SECTIONS: NavSection[] = RAIL_SECTIONS;

const leavesOf = (section: NavSection) => section.nodes.flatMap((node) => (node.kind === "leaf" ? [node] : node.children));

/** Flat list of every module leaf on the client's list, in nav order. */
export const ALL_MODULES: ModuleLeaf[] = NAV_SECTIONS.flatMap(leavesOf);

/** How many modules the client's list has. */
export const MODULE_COUNT = ALL_MODULES.length;

export function findModule(href: string): ModuleLeaf | undefined {
  return LOOKUP_SECTIONS.flatMap(leavesOf).find((m) => m.href === href);
}

/** Where a page sits in the rail — section, and group when it has one — for breadcrumbs. */
export function findTrail(href: string): { section: NavSection; group?: ModuleGroup; module: ModuleLeaf } | undefined {
  for (const section of LOOKUP_SECTIONS) {
    for (const node of section.nodes) {
      if (node.kind === "leaf" && node.href === href) return { section, module: node };
      if (node.kind === "group") {
        const child = node.children.find((c) => c.href === href);
        if (child) return { section, group: node, module: child };
      }
    }
  }
  return undefined;
}
