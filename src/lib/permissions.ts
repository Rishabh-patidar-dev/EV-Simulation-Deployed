/**
 * The permission model behind User Management.
 *
 * Grouped the way the rail is — CRM, DMS, ERP, then platform administration —
 * so the permissions editor reads like the navigation it governs. Each role on
 * the Role-Based Access screen maps to a preset; "Custom" is the one role whose
 * permissions are picked by hand.
 *
 * Honest caveat, repeated in the UI: the simulation has no sign-in, so these
 * are recorded to demonstrate the model, not enforced on any request.
 */

export const PERMISSIONS = [
  "leads.view",
  "leads.manage",
  "enquiries.manage",
  "pipeline.view",
  "pipeline.manage",
  "followups.manage",
  "campaigns.view",
  "campaigns.manage",
  "testdrives.manage",
  "support.view",
  "support.manage",

  "onboarding.view",
  "onboarding.manage",
  "dealers.view",
  "dealers.manage",
  "inventory.view",
  "inventory.manage",
  "orders.view",
  "orders.manage",
  "invoices.view",
  "invoices.manage",
  "warranty.view",
  "warranty.manage",
  "quotations.manage",
  "delivery.manage",
  "finance.manage",
  "rto.manage",
  "service.view",
  "service.manage",

  "documents.view",
  "analytics.view",
  "approvals.act",
  "accounting.manage",
  "integrations.manage",

  "reports.export",
  "data.import",
  "settings.manage",
  "users.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET = new Set<string>(PERMISSIONS);

function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && PERMISSION_SET.has(value);
}

/** Holding "manage" on an area without "view" would be a contradiction, so it implies it. */
const IMPLIED: Partial<Record<Permission, Permission[]>> = {
  "leads.manage": ["leads.view"],
  "enquiries.manage": ["leads.view"],
  "pipeline.manage": ["pipeline.view"],
  "followups.manage": ["leads.view"],
  "campaigns.manage": ["campaigns.view"],
  "onboarding.manage": ["onboarding.view"],
  "dealers.manage": ["dealers.view"],
  "inventory.manage": ["inventory.view"],
  "orders.manage": ["orders.view"],
  "invoices.manage": ["invoices.view"],
  "warranty.manage": ["warranty.view"],
  "testdrives.manage": ["leads.view"],
  "support.manage": ["support.view"],
  "quotations.manage": ["pipeline.view"],
  "delivery.manage": ["pipeline.view", "inventory.view"],
  "finance.manage": ["pipeline.view"],
  "rto.manage": ["pipeline.view"],
  "service.manage": ["service.view", "inventory.view"],
  "accounting.manage": ["invoices.view"],
};

/** Dedupes, drops anything unknown, adds implied permissions, and returns them in catalogue order. */
export function normalizePermissions(values: readonly unknown[]): Permission[] {
  const held = new Set<Permission>();
  for (const value of values) {
    if (!isPermission(value)) continue;
    held.add(value);
    for (const implied of IMPLIED[value] ?? []) held.add(implied);
  }
  return PERMISSIONS.filter((p) => held.has(p));
}

interface PermissionGroup {
  group: string;
  description: string;
  permissions: Array<{ value: Permission; label: string; hint?: string }>;
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    group: "Customer relationship",
    description: "Leads, enquiries, the sales pipeline and campaigns.",
    permissions: [
      { value: "leads.view", label: "View leads and follow-ups" },
      { value: "leads.manage", label: "Create, assign and convert leads" },
      { value: "enquiries.manage", label: "Work the enquiry queue" },
      { value: "pipeline.view", label: "View deals and bookings" },
      { value: "pipeline.manage", label: "Advance deals and bookings", hint: "Booking a deal allocates vehicle stock" },
      { value: "followups.manage", label: "Schedule and complete follow-ups" },
      { value: "campaigns.view", label: "View campaigns and landing pages" },
      { value: "campaigns.manage", label: "Launch, pause and publish campaigns" },
      { value: "testdrives.manage", label: "Schedule and run test drives", hint: "Includes driving-licence checks" },
      { value: "support.view", label: "View support tickets" },
      { value: "support.manage", label: "Work, escalate and resolve tickets" },
    ],
  },
  {
    group: "Dealer network",
    description: "Onboarding, the live network and its compliance.",
    permissions: [
      { value: "onboarding.view", label: "View applications and KYC" },
      { value: "onboarding.manage", label: "Verify KYC and move applications", hint: "Signs dealers into the network" },
      { value: "dealers.view", label: "View Dealer 360 and compliance" },
      { value: "dealers.manage", label: "Edit dealers, tiers and targets" },
    ],
  },
  {
    group: "Stock, orders & billing",
    description: "Vehicle and parts inventory, dealer orders and invoices.",
    permissions: [
      { value: "inventory.view", label: "View vehicle and parts stock" },
      { value: "inventory.manage", label: "Post stock movements", hint: "Adjustments change the inventory log" },
      { value: "orders.view", label: "View dealer orders" },
      { value: "orders.manage", label: "Acknowledge and dispatch orders" },
      { value: "invoices.view", label: "View invoices and receivables" },
      { value: "invoices.manage", label: "Raise invoices and record payments", hint: "Posts financial transactions" },
    ],
  },
  {
    group: "Retail sale & delivery",
    description: "Quotations, loans and insurance, handover and registration.",
    permissions: [
      { value: "quotations.manage", label: "Build quotations and issue tax invoices", hint: "Discounts over the limit go for approval" },
      { value: "finance.manage", label: "Work loan cases and issue insurance" },
      { value: "delivery.manage", label: "Run PDI and hand vehicles over", hint: "Completes the booking and books stock out" },
      { value: "rto.manage", label: "File and track registrations" },
    ],
  },
  {
    group: "After-sales",
    description: "Workshop job cards, warranty claims and supplier recovery.",
    permissions: [
      { value: "service.view", label: "View job cards and service schedules" },
      { value: "service.manage", label: "Open and close job cards", hint: "Issues parts straight off stock" },
      { value: "warranty.view", label: "View warranty claims" },
      { value: "warranty.manage", label: "Adjudicate claims" },
    ],
  },
  {
    group: "ERP & reporting",
    description: "Documents, MIS dashboards and the approval queue.",
    permissions: [
      { value: "documents.view", label: "View the document register" },
      { value: "analytics.view", label: "View dashboards and MIS" },
      { value: "approvals.act", label: "Approve or reject requests", hint: "Discounts, credit limits, onboarding" },
      { value: "accounting.manage", label: "Map ledgers and run the accounting sync", hint: "Posts vouchers to the finance system" },
      { value: "integrations.manage", label: "Connect and configure integrations" },
    ],
  },
  {
    group: "Platform",
    description: "Cross-cutting administration. Grant sparingly.",
    permissions: [
      { value: "reports.export", label: "Export data" },
      { value: "data.import", label: "Bulk import data", hint: "Can create thousands of records at once" },
      { value: "settings.manage", label: "Change workspace settings" },
      { value: "users.manage", label: "Manage users and permissions", hint: "Lets the holder grant themselves anything else" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** Same names, same order as the Role-Based Access screen, plus Custom. */
export const USER_ROLES = [
  "System Admin",
  "Network Expansion",
  "Relationship Manager",
  "Sales Executive",
  "Finance",
  "After Sales",
  "Dealer Principal",
  "Custom",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_PERMISSIONS: Record<Exclude<UserRole, "Custom">, Permission[]> = {
  "System Admin": [...PERMISSIONS],
  "Network Expansion": normalizePermissions(["onboarding.manage", "dealers.view", "documents.view", "analytics.view", "approvals.act"]),
  "Relationship Manager": normalizePermissions([
    "leads.manage", "enquiries.manage", "pipeline.manage", "followups.manage", "campaigns.view", "testdrives.manage", "support.manage",
    "quotations.manage", "finance.manage", "dealers.view", "orders.view", "invoices.view", "analytics.view", "approvals.act", "reports.export",
  ]),
  "Sales Executive": normalizePermissions(["leads.manage", "enquiries.manage", "pipeline.manage", "followups.manage", "testdrives.manage", "quotations.manage", "inventory.view"]),
  Finance: normalizePermissions([
    "invoices.manage", "orders.view", "dealers.view", "finance.manage", "documents.view", "analytics.view", "approvals.act", "accounting.manage", "reports.export",
  ]),
  "After Sales": normalizePermissions([
    "support.manage", "delivery.manage", "rto.manage", "service.manage", "warranty.manage", "inventory.manage", "documents.view", "approvals.act",
  ]),
  "Dealer Principal": normalizePermissions([
    "leads.manage", "pipeline.manage", "followups.manage", "testdrives.manage", "support.view", "quotations.manage", "finance.manage",
    "delivery.manage", "rto.manage", "service.manage", "inventory.view", "orders.manage", "invoices.view", "warranty.view",
  ]),
};

/** What a user can actually reach: the role's preset, or their own list when the role is Custom. */
export function effectivePermissions(user: { role: UserRole; permissions: readonly string[] }): Permission[] {
  return user.role === "Custom" ? normalizePermissions(user.permissions) : ROLE_PERMISSIONS[user.role];
}

export const USER_REGIONS = ["All India", "North", "South", "East", "West", "Central"] as const;
export type UserRegion = (typeof USER_REGIONS)[number];

export const USER_STATUSES = ["Active", "Invited", "Deactivated"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
