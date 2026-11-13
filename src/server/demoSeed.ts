import "server-only";
import { CONNECTOR_CATALOGUE } from "@/lib/connectors";
import { derivedGstin, HSN } from "@/lib/gst";
import { ROLE_PERMISSIONS } from "@/lib/permissions";
import { seedStage } from "@/lib/onboarding";
import { VEHICLE_MODELS } from "@/lib/vehicles";
import type * as T from "./types";

/**
 * Demo data for the built-in store (./memoryStore.ts), used when no database
 * is configured. Deterministic (seeded PRNG) and dated relative to start-up,
 * so ageing, overdue and expiring states always look current.
 */

let seed = 20261113;
const rand = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <V>(list: readonly V[]): V => list[Math.floor(rand() * list.length)];
const pad = (n: number, w = 4) => String(n).padStart(w, "0");

const NOW = Date.now();
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(NOW - d * DAY - int(0, 8) * 3_600_000).toISOString();
const daysAhead = (d: number) => new Date(NOW + d * DAY).toISOString();
const dateOnly = (iso: string) => iso.slice(0, 10);

const FIRST = ["Rahul", "Priya", "Amit", "Sneha", "Vikram", "Anjali", "Rohit", "Kavya", "Suresh", "Neha", "Arjun", "Pooja", "Manoj", "Divya", "Karan", "Meera", "Sanjay", "Ritu", "Deepak", "Asha", "Imran", "Farah", "Gurpreet", "Harish", "Lakshmi"];
const LAST = ["Sharma", "Patel", "Verma", "Reddy", "Singh", "Iyer", "Gupta", "Nair", "Yadav", "Joshi", "Khan", "Das", "Mehta", "Kulkarni", "Chauhan", "Rao", "Mishra", "Pillai"];
const person = () => `${pick(FIRST)} ${pick(LAST)}`;
const phone = () => `9${int(100000000, 999999999)}`;

const CITIES: Array<{ city: string; state: string; pin: string; region: "North" | "South" | "East" | "West" | "Central" }> = [
  { city: "Delhi", state: "Delhi", pin: "110001", region: "North" },
  { city: "Lucknow", state: "Uttar Pradesh", pin: "226001", region: "North" },
  { city: "Jaipur", state: "Rajasthan", pin: "302001", region: "North" },
  { city: "Patna", state: "Bihar", pin: "800001", region: "East" },
  { city: "Kolkata", state: "West Bengal", pin: "700001", region: "East" },
  { city: "Pune", state: "Maharashtra", pin: "411001", region: "West" },
  { city: "Ahmedabad", state: "Gujarat", pin: "380001", region: "West" },
  { city: "Indore", state: "Madhya Pradesh", pin: "452001", region: "Central" },
  { city: "Bengaluru", state: "Karnataka", pin: "560001", region: "South" },
  { city: "Hyderabad", state: "Telangana", pin: "500001", region: "South" },
];

const STAFF = ["Akash Menon", "Neha Kapoor", "Ravi Shankar", "Sunita Rao", "Vivek Malhotra", "Pallavi Desai"];

const MODELS = VEHICLE_MODELS;
const PASSENGER = new Set(["Queen EV", "Queen EV DLX", "Queen Mini DLX", "LX Spark", "LX Speedo", "LX EV DLX", "LX EV 1.5 S.DLX", "LX TEV DLX", "LX TEV Mega"]);
const basePrice = (model: string) => 135_000 + (MODELS.indexOf(model) % 9) * 12_500;

// ---------------------------------------------------------------- products
const products: T.Product[] = MODELS.map((model, i) => {
  const passenger = PASSENGER.has(model);
  const base = basePrice(model);
  return {
    id: `PRD-${pad(i + 1, 3)}`,
    model,
    segment: i % 3 === 0 ? "L5" : "L3",
    bodyType: passenger ? "Passenger" : pick(["Cargo", "Delivery", "Garbage", "Mobile Business"] as const),
    rtoClass: passenger ? (i % 3 === 0 ? "L5 Passenger" : "e-Rickshaw") : i % 3 === 0 ? "L5 Goods" : "e-Cart",
    hsn: passenger ? HSN.passengerVehicle : HSN.goodsVehicle,
    motor: `${pick(["1.2", "1.5", "2.0"])} kW BLDC`,
    battery: `${pick(["5.1", "7.2", "9.6"])} kWh Li-ion`,
    range: `${int(90, 160)} km`,
    capacity: passenger ? "Driver + 4" : `${int(4, 7) * 100} kg`,
    warranty: "3 years / 60,000 km",
    subsidyEligible: i % 4 !== 3,
    variants: (["Standard", "Deluxe", "Mega", "Super Deluxe"] as const).map((variant, v) => ({
      variant,
      exShowroom: base + v * 15_000,
      dealerPrice: Math.round((base + v * 15_000) * 0.88),
      batteryKwh: [5.1, 7.2, 9.6, 10.8][v],
    })),
    active: true,
    updatedAt: daysAgo(int(5, 60)),
  };
});

// ---------------------------------------------------------------- dealers
const DEALER_NAMES = ["Green Wheels Motors", "Shakti EV Point", "Urban E-Mobility", "Vayu Electric", "Sai Auto Agencies", "Prakriti EV Hub", "Metro Electric Drives", "Ganga E-Vehicles", "Deccan Green Auto", "Sunrise EV World"];
const dealers: T.Dealer[] = DEALER_NAMES.map((name, i) => {
  const loc = CITIES[i];
  const target = int(120, 400);
  return {
    id: `DLR-${pad(i + 1, 3)}`,
    code: `LXG-${loc.city.slice(0, 3).toUpperCase()}-${pad(i + 1, 2)}`,
    name,
    city: loc.city,
    state: loc.state,
    tier: pick(["Platinum", "Gold", "Gold", "Silver", "Bronze"] as const),
    status: i === 9 ? "Onboarding" : i === 7 ? "Suspended" : "Active",
    ytdUnits: Math.round(target * (0.4 + rand() * 0.7)),
    targetUnits: target,
    outstanding: int(2, 40) * 50_000,
    health: int(55, 98),
    gstin: derivedGstin(name, loc.state),
    logo: null,
    creditLimit: int(20, 60) * 100_000,
    creditDays: 30,
    securityDeposit: 500_000,
  };
});
const dealerNames = dealers.filter((d) => d.status === "Active").map((d) => d.name);

// ---------------------------------------------------------------- users & roles
const users: T.AppUser[] = [
  ["Akash Menon", "System Admin", "All India", null],
  ["Neha Kapoor", "Relationship Manager", "North", null],
  ["Ravi Shankar", "Network Expansion", "All India", null],
  ["Sunita Rao", "Finance", "All India", null],
  ["Vivek Malhotra", "After Sales", "West", null],
  ["Pallavi Desai", "Sales Executive", "West", DEALER_NAMES[5]],
  ["Harish Kumar", "Dealer Principal", "North", DEALER_NAMES[0]],
  ["Lakshmi Iyer", "Sales Executive", "South", DEALER_NAMES[8]],
].map(([name, role, region, dealer], i) => ({
  id: `USR-${pad(i + 1)}`,
  name: name as string,
  email: `${(name as string).toLowerCase().replace(/\s+/g, ".")}@luxusgreen.example`,
  phone: phone(),
  role: role as T.AppUser["role"],
  region: region as T.AppUser["region"],
  dealer: dealer as string | null,
  status: i === 7 ? "Invited" : "Active",
  permissions: [...ROLE_PERMISSIONS[role as Exclude<T.AppUser["role"], "Custom">]],
  lastActiveAt: i === 7 ? null : daysAgo(int(0, 3)),
  invitedAt: daysAgo(200 - i * 10),
  createdAt: daysAgo(200 - i * 10),
}));

const roles: T.RoleRecord[] = [
  ["System Admin", "All modules", 31, "Everything"],
  ["Relationship Manager", "CRM + Finance", 15, "Discounts up to 5%"],
  ["Network Expansion", "Dealer onboarding", 5, "Dealer onboarding"],
  ["Finance", "Invoices, credit, accounting", 9, "Credit limits"],
  ["After Sales", "Service + Warranty", 8, "Warranty claims"],
  ["Sales Executive", "Leads to quotation", 7, "None"],
  ["Dealer Principal", "Own dealership", 10, "Dealer orders"],
].map(([role, scope, modules, canApprove], i) => ({
  id: `ROLE-${pad(i + 1, 2)}`,
  role: role as string,
  users: users.filter((u) => u.role === role).length,
  scope: scope as string,
  modules: modules as number,
  canApprove: canApprove as string,
}));

// ---------------------------------------------------------------- CRM
const LEAD_STATUSES: T.Lead["status"][] = ["New", "New", "Contacted", "Contacted", "Qualified", "Test Drive", "Converted", "Lost"];
const LEAD_SOURCES: T.Lead["source"][] = ["Landing Page", "WhatsApp", "Walk-in", "Referral", "Dealer", "Call Centre", "Expo"];
const NEXT_ACTIONS = ["Call back with EMI options", "Schedule test drive", "Share brochure on WhatsApp", "Send quotation", "Follow up on finance documents", "Invite to showroom"];

const leads: T.Lead[] = Array.from({ length: 48 }, (_, i) => {
  const loc = pick(CITIES);
  const created = int(0, 75);
  const model = pick(MODELS);
  const status = pick(LEAD_STATUSES);
  const name = person();
  return {
    id: `LEAD-${pad(1001 + i)}`,
    name,
    phone: phone(),
    city: loc.city,
    model,
    source: pick(LEAD_SOURCES),
    status,
    assignedTo: rand() < 0.85 ? pick(STAFF) : null,
    dealer: pick(dealerNames),
    score: int(25, 95),
    value: basePrice(model) * int(1, 4),
    createdAt: daysAgo(created),
    updatedAt: daysAgo(Math.max(0, created - int(0, 10))),
    nextAction: pick(NEXT_ACTIONS),
    dealId: null,
    email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
    state: loc.state,
    pincode: loc.pin,
  };
});

const lead_remarks: T.LeadRemark[] = leads.slice(0, 20).map((lead, i) => ({
  id: `REM-${pad(i + 1)}`,
  leadId: lead.id,
  author: lead.assignedTo ?? "Neha Kapoor",
  note: pick(["Interested in fleet pricing for 3 units.", "Asked about subsidy eligibility.", "Wants a demo at their location.", "Comparing with a competitor, price-sensitive.", "Needs finance — shared NBFC options."]),
  createdAt: lead.updatedAt,
}));

const segments: T.Segment[] = [
  { id: "SEG-001", name: "Hot leads (score 70+)", filter: { minScore: 70 }, channel: "WhatsApp", createdBy: "Neha Kapoor", updatedAt: daysAgo(4) },
  { id: "SEG-002", name: "Landing page — new", filter: { source: "Landing Page", status: "New" }, channel: "Email", createdBy: "Akash Menon", updatedAt: daysAgo(9) },
  { id: "SEG-003", name: "Pune prospects", filter: { city: "Pune" }, channel: "SMS", createdBy: "Pallavi Desai", updatedAt: daysAgo(15) },
];

const enquiries: T.Enquiry[] = Array.from({ length: 24 }, (_, i) => {
  const model = pick(MODELS);
  const loc = pick(CITIES);
  return {
    id: `ENQ-${pad(i + 1)}`,
    reference: `ENQ/26/${pad(3101 + i)}`,
    customer: person(),
    phone: phone(),
    model,
    channel: pick(["Landing Page", "WhatsApp", "Phone", "Walk-in"] as const),
    dealer: pick(dealerNames),
    status: pick(["Open", "Open", "Responded", "Quoted", "Closed"] as const),
    value: basePrice(model) * int(1, 3),
    createdAt: daysAgo(int(0, 30)),
    leadId: null,
    city: loc.city,
  };
});

const DEAL_STAGES = ["Qualified", "Demo", "Quotation", "Negotiation", "Booked"] as const;
const deals: T.Deal[] = leads
  .filter((l) => l.status === "Qualified" || l.status === "Test Drive" || l.status === "Converted")
  .map((lead, i) => {
    const stage = lead.status === "Converted" ? "Booked" : pick(DEAL_STAGES.slice(0, 4));
    const id = `DEAL-${pad(501 + i)}`;
    lead.dealId = id;
    return {
      id,
      leadId: lead.id,
      customer: lead.name,
      phone: lead.phone,
      dealer: lead.dealer ?? dealerNames[0],
      model: lead.model,
      stage,
      value: lead.value,
      ageingDays: int(2, 40),
      expectedClose: dateOnly(daysAhead(int(3, 45))),
      createdAt: lead.updatedAt,
      bookingId: null,
    };
  });

const bookings: T.Booking[] = deals
  .filter((d) => d.stage === "Booked")
  .concat(deals.slice(0, 4))
  .map((deal, i) => {
    const id = `BKG-${pad(4801 + i)}`;
    deal.bookingId = id;
    const quantity = Math.max(1, Math.round(deal.value / basePrice(deal.model)));
    const unitPrice = basePrice(deal.model);
    return {
      id,
      bookingNo: `BKG/26/${4801 + i}`,
      dealId: deal.id,
      customer: deal.customer,
      dealer: deal.dealer,
      model: deal.model,
      token: 10_000 * quantity,
      total: unitPrice * quantity,
      status: pick(["Confirmed", "Awaiting Finance", "Ready for Delivery", "Delivered"] as const),
      bookedAt: daysAgo(int(1, 30)),
      deliveryEta: dateOnly(daysAhead(int(2, 20))),
      vehicleUnitId: null,
      quantity,
      unitPrice,
      phone: deal.phone,
      quotationId: null,
    };
  });

const follow_ups: T.FollowUp[] = leads.slice(0, 18).map((lead, i) => {
  const offset = int(-4, 6);
  return {
    id: `FU-${pad(i + 1)}`,
    subject: lead.nextAction,
    relatedTo: lead.id,
    customer: lead.name,
    owner: lead.assignedTo ?? "Neha Kapoor",
    channel: pick(["Call", "WhatsApp", "Visit", "Email"] as const),
    dueAt: offset < 0 ? daysAgo(-offset) : daysAhead(offset),
    status: i % 6 === 0 ? "Done" : offset < 0 ? "Overdue" : "Due",
  };
});

const landing_pages: T.LandingPage[] = [
  { id: "LP-001", name: "Queen EV — Festive Offer", slug: "queen-ev-festive", status: "Live", views: 18_420, submissions: 612, updatedAt: daysAgo(3), uniqueId: "lp_queen_festive", intent: "Retail", campaignId: "CMP-001" },
  { id: "LP-002", name: "Become a Luxus Green Dealer", slug: "dealership", status: "Live", views: 6_310, submissions: 148, updatedAt: daysAgo(12), uniqueId: "lp_dealer", intent: "Dealership", campaignId: null },
  { id: "LP-003", name: "LX Cargo — Fleet Pricing", slug: "cargo-fleet", status: "Draft", views: 0, submissions: 0, updatedAt: daysAgo(1), uniqueId: "lp_cargo_fleet", intent: "Retail", campaignId: null },
];

const campaigns: T.Campaign[] = [
  { id: "CMP-001", name: "Festive Queen EV Push", channel: "Landing Page", status: "Running", spend: 240_000, reached: 52_000, responded: 3_400, leads: 612, startedAt: daysAgo(20), landingPageId: "LP-001" },
  { id: "CMP-002", name: "Hot Lead WhatsApp Nudge", channel: "WhatsApp", status: "Completed", spend: 18_000, reached: 1_250, responded: 410, leads: 96, startedAt: daysAgo(35), segmentId: "SEG-001", template: "lx_offer_reminder" },
  { id: "CMP-003", name: "Cargo Fleet Email Series", channel: "Email", status: "Scheduled", spend: 0, reached: 0, responded: 0, leads: 0, startedAt: daysAhead(5) },
  { id: "CMP-004", name: "Monsoon Service Camp SMS", channel: "SMS", status: "Paused", spend: 9_500, reached: 8_200, responded: 260, leads: 31, startedAt: daysAgo(50) },
];

const test_drives: T.TestDrive[] = leads.slice(5, 19).map((lead, i) => {
  const offset = int(-10, 7);
  const status = offset > 0 ? "Scheduled" : pick(["Completed", "Completed", "No Show", "Cancelled"] as const);
  return {
    id: `TD-${pad(i + 1)}`,
    driveNo: `TD/26/${pad(701 + i)}`,
    leadId: lead.id,
    customer: lead.name,
    phone: lead.phone,
    model: lead.model,
    dealer: lead.dealer ?? dealerNames[0],
    slotAt: offset < 0 ? daysAgo(-offset) : daysAhead(offset),
    durationMin: 30,
    status,
    bookedVia: pick(["Dealer", "Landing Page", "Call Centre", "WhatsApp"] as const),
    licenceNo: status === "Completed" ? `DL-${int(10, 99)}${int(2010, 2023)}${pad(int(1, 9999), 7)}` : null,
    licenceVerified: status === "Completed",
    feedback: status === "Completed" ? { rating: int(3, 5), interest: pick(["Hot", "Warm", "Cold"] as const), comments: "Liked the pickup and range." } : null,
    createdAt: daysAgo(int(10, 20)),
    createdBy: lead.assignedTo ?? "Neha Kapoor",
    completedAt: status === "Completed" ? daysAgo(-offset) : null,
    cancelReason: status === "Cancelled" ? "Customer rescheduling" : null,
  };
});

// ---------------------------------------------------------------- DMS
const applications: T.Application[] = [
  ["Om Sai E-Motors", "Nagpur", "Maharashtra", "Dealer", "Documents", "In Progress"],
  ["Kaveri Green Mobility", "Mysuru", "Karnataka", "Dealer", "Verification", "In Progress"],
  ["Bharat EV Distributors", "Kanpur", "Uttar Pradesh", "Distributor", "Approval", "In Progress"],
  ["Coastal E-Auto", "Visakhapatnam", "Andhra Pradesh", "Service Partner", "Enquiry", "In Progress"],
  ["Narmada Auto Links", "Bhopal", "Madhya Pradesh", "Dealer", "Agreement", "Approved"],
  ["Royal EV Traders", "Ludhiana", "Punjab", "Dealer", "Documents", "On Hold"],
].map(([firm, city, state, intent, stage, status], i) => ({
  id: `APP-${pad(i + 1)}`,
  applicationNo: `DAP/26/${pad(201 + i)}`,
  firm: firm as string,
  city: city as string,
  state: state as string,
  intent: intent as T.Application["intent"],
  stage: stage as T.Application["stage"],
  status: status as T.Application["status"],
  owner: pick(["Ravi Shankar", "Akash Menon"]),
  submittedAt: daysAgo(int(5, 60)),
  contactName: person(),
  phone: phone(),
  email: `contact@${(firm as string).toLowerCase().replace(/[^a-z]/g, "")}.example`,
  gstin: derivedGstin(firm as string, state as string),
  investment: pick(["₹25–50 L", "₹50 L–1 Cr", "Over ₹1 Cr"]),
  source: pick(["Landing Page", "Referral", "Expo"]),
  stageDocs: seedStage(stage as T.Application["stage"]),
  stageEnteredAt: daysAgo(int(1, 9)),
  reason: status === "On Hold" ? "Awaiting premises lease agreement" : null,
  history: [{ status: "Enquiry", at: daysAgo(60), by: "Ravi Shankar" }],
}));

const kyc_documents: T.KycDocument[] = applications.flatMap((app, i) =>
  (["PAN", "GST Certificate", "Trade Licence", "Bank Proof"] as const).map((docType, j) => {
    const status = pick(["Verified", "Pending", "Pending", "Not Uploaded"] as const);
    return {
      id: `KYC-${pad(i * 4 + j + 1)}`,
      applicationNo: app.applicationNo,
      firm: app.firm,
      docType,
      status,
      uploadedAt: status === "Not Uploaded" ? null : daysAgo(int(1, 20)),
      verifiedBy: status === "Verified" ? "Ravi Shankar" : null,
    };
  })
);

const compliance: T.ComplianceRecord[] = dealers.flatMap((dealer, i) =>
  (["Trade Licence", "GST Registration", "Dealer Agreement"] as const).map((docType, j) => {
    const days = int(-20, 300);
    return {
      id: `CMPL-${pad(i * 3 + j + 1)}`,
      dealer: dealer.name,
      docType,
      reference: `${docType.split(" ")[0].toUpperCase()}/${int(10000, 99999)}`,
      expiresOn: dateOnly(days < 0 ? daysAgo(-days) : daysAhead(days)),
      status: days < 0 ? "Expired" : days < 30 ? "Expiring Soon" : "Valid",
      issuedOn: dateOnly(daysAgo(400)),
    };
  })
);

const vehicle_units: T.VehicleUnit[] = Array.from({ length: 60 }, (_, i) => {
  const model = pick(MODELS);
  return {
    id: `VU-${pad(i + 1)}`,
    vin: `MD9LXG${int(10, 99)}${pick(["A", "B", "C"])}${pad(int(1, 999999), 6)}`,
    model,
    variant: pick(["Standard", "Deluxe", "Mega", "Super Deluxe"]),
    location: i < 25 ? "OEM Plant — Indore" : pick(dealerNames),
    status: pick(["In Stock", "In Stock", "In Stock", "Allocated", "In Transit", "Delivered"] as const),
    ageingDays: int(1, 120),
    price: basePrice(model),
  };
});

const PARTS: Array<[string, T.SparePart["category"], number]> = [
  ["Li-ion Battery Pack 7.2 kWh", "Battery", 68_000],
  ["BLDC Hub Motor 1.5 kW", "Motor", 14_500],
  ["Motor Controller 48V", "Controller", 7_800],
  ["Front Windshield", "Body", 2_400],
  ["Headlamp Assembly", "Electrical", 1_150],
  ["Brake Shoe Set", "Consumable", 420],
  ["DC-DC Converter", "Electrical", 2_900],
  ["Rear Leaf Spring", "Body", 1_800],
  ["Throttle Assembly", "Controller", 950],
  ["Charger 48V 15A", "Electrical", 6_200],
  ["Tyre 3.75-12", "Consumable", 1_600],
  ["Wiring Harness Main", "Electrical", 3_300],
];
const spare_parts: T.SparePart[] = PARTS.map(([name, category, unitPrice], i) => ({
  id: `SP-${pad(i + 1)}`,
  sku: `LXP-${pad(1001 + i)}`,
  name,
  category,
  onHand: int(0, 140),
  reorderLevel: 20,
  unitPrice,
  location: pick(["Central Warehouse — Indore", "Regional Depot — Pune", "Regional Depot — Lucknow"]),
}));

const inventory_logs: T.InventoryLog[] = Array.from({ length: 20 }, (_, i) => {
  const vehicle = i % 2 === 0;
  return {
    id: `INV-${pad(i + 1)}`,
    at: daysAgo(int(0, 25)),
    entity: vehicle ? "Vehicle" : "Spare Part",
    reference: vehicle ? pick(vehicle_units).vin : pick(spare_parts).sku,
    direction: pick(["IN", "OUT"] as const),
    quantity: vehicle ? 1 : int(2, 30),
    bucket: pick(["OEM Plant", "Central Warehouse", "Dealer Stock"]),
    actor: pick(STAFF),
  };
});

const orders: T.Order[] = Array.from({ length: 16 }, (_, i) => {
  const dealer = pick(dealerNames);
  const lines: T.OrderLine[] = Array.from({ length: int(1, 3) }, () => {
    const model = pick(MODELS);
    return { model, variant: pick(["Standard", "Deluxe", "Mega", "Super Deluxe"] as const), quantity: int(2, 12), unitPrice: Math.round(basePrice(model) * 0.88) };
  });
  const status = pick(["Placed", "Acknowledged", "In Production", "Dispatched", "Received", "Received"] as const);
  const placed = int(2, 45);
  return {
    id: `ORD-${pad(i + 1)}`,
    orderNo: `PO/26/${pad(1201 + i)}`,
    dealer,
    lineItems: lines.length,
    units: lines.reduce((s, l) => s + l.quantity, 0),
    value: lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0),
    status,
    placedAt: daysAgo(placed),
    expectedBy: dateOnly(daysAhead(int(3, 25))),
    lines,
    history: [{ status: "Placed", at: daysAgo(placed), by: users[6].name }],
    placedBy: users[6].name,
    invoiceId: null,
  };
});

const invoices: T.Invoice[] = Array.from({ length: 18 }, (_, i) => {
  const amount = int(4, 60) * 25_000;
  const status = pick(["Paid", "Part Paid", "Unpaid", "Overdue"] as const);
  const received = status === "Paid" ? amount : status === "Part Paid" ? Math.round(amount * 0.4) : 0;
  const issued = int(5, 70);
  return {
    id: `INVC-${pad(i + 1)}`,
    invoiceNo: `INV/26/${pad(5101 + i)}`,
    dealer: pick(dealerNames),
    type: pick(["Vehicle", "Vehicle", "Spare Part", "Service"] as const),
    amount,
    received,
    status,
    issuedAt: daysAgo(issued),
    dueOn: dateOnly(status === "Overdue" ? daysAgo(int(1, 20)) : daysAhead(30 - issued > 0 ? 30 - issued : 5)),
    payments: received ? [{ at: daysAgo(int(1, 5)), amount: received, mode: pick(["NEFT/RTGS", "UPI", "Cheque"] as const), reference: `UTR${int(100000000, 999999999)}`, by: "Sunita Rao" }] : [],
  };
});

const warranty_claims: T.WarrantyClaim[] = Array.from({ length: 10 }, (_, i) => {
  const unit = vehicle_units[30 + i];
  const status = pick(["Submitted", "Under Review", "Approved", "In Repair", "Reimbursed", "Rejected"] as const);
  return {
    id: `WC-${pad(i + 1)}`,
    claimNo: `WCL/26/${pad(301 + i)}`,
    dealer: pick(dealerNames),
    vin: unit.vin,
    component: pick(["Battery Pack", "Motor", "Controller", "Charger", "Harness"] as const),
    status,
    claimedAmount: int(3, 70) * 1_000,
    raisedAt: daysAgo(int(1, 40)),
    model: unit.model,
    customer: person(),
    customerPhone: phone(),
    issue: pick(["Range dropped below 60 km", "Motor noise at low speed", "Charger not charging", "Controller error E04"]),
    odometerKm: int(2_000, 30_000),
    history: [{ status: "Submitted", at: daysAgo(40), by: "Vivek Malhotra" }],
  };
});

const job_cards: T.JobCard[] = Array.from({ length: 8 }, (_, i) => {
  const unit = vehicle_units[45 + i];
  const status = pick(["Open", "In Progress", "Ready", "Closed", "Awaiting Parts"] as const);
  return {
    id: `JC-${pad(i + 1)}`,
    jobNo: `JOB/26/${pad(901 + i)}`,
    dealer: pick(dealerNames),
    customer: person(),
    phone: phone(),
    vin: unit.vin,
    model: unit.model,
    registrationNo: `MH12${pick(["AB", "CD", "EF"])}${int(1000, 9999)}`,
    odometerKm: int(800, 25_000),
    serviceType: pick(["Free Service", "Paid Service", "Running Repair"] as const),
    freeServiceNo: null,
    complaints: [{ complaint: pick(["Brake noise", "Low range", "Indicator not working"]), cause: "Wear", correction: "Replaced and tested" }],
    technician: pick(["Ramesh", "Suraj", "Anil"]),
    labour: [{ description: "General inspection", hours: 1, rate: 450, billTo: "Customer" }],
    parts: [],
    status,
    openedAt: daysAgo(int(0, 10)),
    promisedAt: daysAhead(int(0, 3)),
    closedAt: status === "Closed" ? daysAgo(0) : null,
    warrantyClaimId: null,
    taxInvoiceId: null,
    nextServiceAt: null,
    nextServiceKm: null,
    history: [{ status: "Open", at: daysAgo(10), by: "Vivek Malhotra" }],
  };
});

const approvals: T.Approval[] = [
  { id: "APR-001", type: "Discount", subject: "Extra ₹8,000 off — Queen EV DLX x3", requestedBy: "Pallavi Desai", pendingWith: "Neha Kapoor", raisedAt: daysAgo(1), ageingHours: 26, status: "Pending" },
  { id: "APR-002", type: "Credit Limit", subject: `Raise limit for ${DEALER_NAMES[1]} to ₹45 L`, requestedBy: "Sunita Rao", pendingWith: "Akash Menon", raisedAt: daysAgo(2), ageingHours: 50, status: "Pending" },
  { id: "APR-003", type: "Dealer Onboarding", subject: "Bharat EV Distributors — Kanpur", requestedBy: "Ravi Shankar", pendingWith: "Akash Menon", raisedAt: daysAgo(3), ageingHours: 75, status: "Pending", link: { kind: "application", id: "APP-003" } },
  { id: "APR-004", type: "Warranty Claim", subject: "WCL/26/0302 — Battery Pack", requestedBy: "Vivek Malhotra", pendingWith: "Akash Menon", raisedAt: daysAgo(6), ageingHours: 140, status: "Approved", decidedBy: "Akash Menon", decidedAt: daysAgo(5) },
];

const documents: T.DocumentRecord[] = [
  ...applications.map((a, i) => ({ id: `DOC-${pad(i + 1)}`, name: `${a.firm} — PAN.pdf`, kind: "KYC" as const, linkedTo: a.applicationNo, owner: "Ravi Shankar", sizeKb: int(120, 900), uploadedAt: daysAgo(int(1, 30)), status: pick(["Verified", "Pending"] as const) })),
  ...dealers.slice(0, 6).map((d, i) => ({ id: `DOC-${pad(i + 20)}`, name: `${d.name} — Dealer Agreement.pdf`, kind: "Agreement" as const, linkedTo: d.code, owner: "Akash Menon", sizeKb: int(400, 2400), uploadedAt: daysAgo(int(30, 200)), status: "Verified" as const })),
];

// ---------------------------------------------------------------- support, finance, integrations
const tickets: T.SupportTicket[] = Array.from({ length: 10 }, (_, i) => {
  const opened = int(0, 12);
  const status = pick(["Open", "In Progress", "Awaiting Customer", "Escalated", "Resolved"] as const);
  const customer = person();
  return {
    id: `TKT-${pad(i + 1)}`,
    ticketNo: `TKT/26/${pad(1501 + i)}`,
    customer,
    phone: phone(),
    city: pick(CITIES).city,
    channel: pick(["Phone", "WhatsApp", "Email", "Web Form"] as const),
    category: pick(["Service Support", "Warranty Support", "Spare Parts", "Product Enquiry", "General Enquiry"] as const),
    priority: pick(["P1", "P2", "P3", "P4"] as const),
    subject: pick(["Vehicle not charging fully", "Need service appointment", "Spare part availability", "Subsidy query", "Delivery date update"]),
    model: pick(MODELS),
    vin: null,
    dealer: pick(dealerNames),
    claimId: null,
    status,
    assignee: pick(STAFF),
    escalatedTo: status === "Escalated" ? "Vivek Malhotra" : null,
    openedAt: daysAgo(opened),
    respondBy: daysAhead(1 - opened),
    resolveBy: daysAhead(3 - opened),
    firstResponseAt: status === "Open" ? null : daysAgo(Math.max(0, opened - 1)),
    resolvedAt: status === "Resolved" ? daysAgo(0) : null,
    resolution: status === "Resolved" ? "Issue fixed at dealer workshop." : null,
    csat: status === "Resolved" ? int(3, 5) : null,
    thread: [{ at: daysAgo(opened), by: customer, kind: "Customer", text: "Please help with this issue." }],
  };
});

const financiers: T.Financier[] = [
  ["Bajaj Finance", "NBFC", 11.5, 48, 15, 1.5, 1.2],
  ["HDFC Bank", "Bank", 9.75, 60, 10, 1, 0.8],
  ["Shriram Finance", "NBFC", 13, 36, 20, 2, 1.5],
  ["Revfin", "NBFC", 14.5, 36, 10, 2, 1.8],
].map(([name, kind, rateFrom, maxTenure, minDownPct, processingFeePct, payoutPct], i) => ({
  id: `FIN-${pad(i + 1, 2)}`,
  name: name as string,
  kind: kind as T.Financier["kind"],
  rateFrom: rateFrom as number,
  maxTenure: maxTenure as number,
  minDownPct: minDownPct as number,
  processingFeePct: processingFeePct as number,
  payoutPct: payoutPct as number,
  active: true,
}));

const ledger_mappings: T.LedgerMapping[] = (
  [
    ["sales_vehicle", "Vehicle sales", "Sales Accounts", "Sales — Vehicles"],
    ["sales_parts", "Spare part sales", "Sales Accounts", "Sales — Spares"],
    ["sales_service", "Service income", "Sales Accounts", "Sales — Service"],
    ["output_cgst", "Output CGST", "Duties & Taxes", "Output CGST"],
    ["output_sgst", "Output SGST", "Duties & Taxes", "Output SGST"],
    ["output_igst", "Output IGST", "Duties & Taxes", "Output IGST"],
    ["debtors_dealers", "Dealer debtors", "Sundry Debtors", "Dealers"],
    ["debtors_retail", "Retail debtors", "Sundry Debtors", null],
    ["bank", "Bank", "Bank Accounts", "HDFC Current A/c"],
    ["finance_payout_income", "Finance payout income", "Indirect Incomes", null],
    ["insurance_commission_income", "Insurance commission", "Indirect Incomes", null],
    ["warranty_expense", "Warranty expense", "Direct Expenses", "Warranty Expenses"],
  ] as const
).map(([key, label, group, ledgerName], i) => ({ id: `LED-${pad(i + 1, 2)}`, key, label, group, ledgerName, costCentre: null, updatedAt: daysAgo(30) }));

const connectors: T.Connector[] = CONNECTOR_CATALOGUE.map((c, i) => ({
  id: `CON-${pad(i + 1, 2)}`,
  key: c.key,
  name: c.name,
  provider: c.provider,
  category: c.category,
  status: i < 4 ? "Connected" : "Disconnected",
  environment: "Sandbox",
  config: c.config,
  credentialsSet: i < 4,
  lastEventAt: i < 4 ? daysAgo(0) : null,
  lastError: null,
  updatedAt: daysAgo(20),
}));

const message_templates: T.MessageTemplate[] = [
  { id: "MT-001", channel: "WhatsApp", name: "lx_quotation", category: "Utility", senderId: null, dltTemplateId: null, body: "Hi {{1}}, your quotation {{2}} for {{3}} is ready: {{4}}", status: "Approved", updatedAt: daysAgo(40) },
  { id: "MT-002", channel: "WhatsApp", name: "lx_offer_reminder", category: "Marketing", senderId: null, dltTemplateId: null, body: "Hi {{1}}, festive offers on {{2}} end this week. Book a test drive today!", status: "Approved", updatedAt: daysAgo(25) },
  { id: "MT-003", channel: "SMS", name: "delivery_otp", category: "Transactional", senderId: "LXSGRN", dltTemplateId: "1107161234567890123", body: "Your Luxus Green delivery OTP is {#var#}. Share it only at handover.", status: "Approved", updatedAt: daysAgo(60) },
];

const messages: T.Message[] = leads.slice(0, 12).map((lead, i) => ({
  id: `MSG-${pad(i + 1)}`,
  channel: "WhatsApp",
  to: lead.phone,
  customer: lead.name,
  templateId: "MT-002",
  template: "lx_offer_reminder",
  body: `Hi ${lead.name.split(" ")[0]}, festive offers on ${lead.model} end this week. Book a test drive today!`,
  status: pick(["Sent", "Delivered", "Read", "Read", "Failed"] as const),
  error: null,
  related: { kind: "lead", id: lead.id, label: lead.name },
  at: daysAgo(int(0, 10)),
}));

const payments: T.Payment[] = bookings.map((b, i) => ({
  id: `PAY-${pad(i + 1)}`,
  gatewayRef: `pay_${int(10_000_000, 99_999_999)}`,
  purpose: "Booking Token",
  payer: b.customer,
  amount: b.token,
  method: pick(["UPI", "Card", "Net Banking"] as const),
  status: "Captured",
  fee: Math.round(b.token * 0.02),
  related: { kind: "booking", id: b.id, label: b.bookingNo },
  createdAt: b.bookedAt,
  capturedAt: b.bookedAt,
  settledAt: b.bookedAt,
}));

const telematics: T.TelematicsDevice[] = vehicle_units
  .filter((u) => u.status === "Delivered")
  .map((u, i) => ({
    id: `TEL-${pad(i + 1)}`,
    imei: `86${int(1_000_000_000, 9_999_999_999)}${int(100, 999)}`,
    vin: u.vin,
    model: u.model,
    customer: person(),
    dealer: pick(dealerNames),
    activatedAt: daysAgo(int(20, 200)),
    soc: int(15, 100),
    soh: int(85, 100),
    odometerKm: int(500, 30_000),
    city: pick(CITIES).city,
    lastSeenAt: daysAgo(0),
    status: rand() < 0.8 ? "Online" : "Offline",
    alerts: rand() < 0.2 ? ["Low SOC"] : [],
  }));

export function demoDataset(): T.Dataset {
  return {
    leads,
    lead_remarks,
    segments,
    enquiries,
    deals,
    bookings,
    follow_ups,
    campaigns,
    landing_pages,
    applications,
    kyc_documents,
    dealers,
    compliance,
    vehicle_units,
    spare_parts,
    inventory_logs,
    orders,
    invoices,
    warranty_claims,
    documents,
    roles,
    approvals,
    users,
    products,
    quotations: [],
    tax_invoices: [],
    test_drives,
    tickets,
    financiers,
    finance_cases: [],
    insurance_policies: [],
    deliveries: [],
    registrations: [],
    job_cards,
    ledger_mappings,
    sync_queue: [],
    connectors,
    messages,
    message_templates,
    payments,
    telematics,
    part_orders: [],
  };
}
