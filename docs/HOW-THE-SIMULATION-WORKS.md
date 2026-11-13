# How the EV-Simulation works

This guide explains what the simulation is, how a click turns into data, how
the modules hand work to each other, and how to demo it. It is written for
someone who has to present it or extend it. The README covers each module's
features in more detail; this guide covers how the parts fit together.

---

## 1. What it is

Luxus Green's real stack is three separate apps that talk over HTTP:

| Real system | What it does |
|---|---|
| **EV-CRM** | Leads, campaigns, dealer onboarding, dealer management, warranty, order and purchase management for the OEM's staff |
| **DMS** | The dealer's own portal: their orders, invoices, inventory, service and warranty |
| **Landing page** | Public capture of retail enquiries and dealership applications |

**EV-Simulation is all of them in one Next.js app with one sidebar.** A lead
captured in CRM, an order raised in DMS and an invoice posted to the ERP sit
behind the same rail. Work moves **between modules, never between
dashboards**. Nothing has to be synchronised, because there is one database.

The point of it is to **show the whole operating model working**: every screen
reads and writes real rows, and an action in one module visibly changes the
others (stock, invoices, the books, the notification bell).

---

## 2. Architecture: one request, end to end

```
Browser ──click──▶ <ActionForm> ──POST──▶ Server Action (src/server/actions/*.ts)
                                              │  validates every field (input.ts)
                                              │  reads the rows it needs (store.ts)
                                              │  writes rows, runs workflows (workflows/*.ts)
                                              ▼
                                         Supabase  sim_<collection> tables
                                              │
                                   refresh() ─┘ revalidates every page
                                              ▼
Browser ◀──toast "what actually happened"── ActionResult { ok, message, description }
Browser ◀──fresh HTML── Server Component page reads store.ts again
```

| Layer | Where | What it does |
|---|---|---|
| Pages | `src/app/**/page.tsx` | **React Server Components.** They call `readMany([...])` straight from the store, so painting a screen is one round trip to the database, with no browser fetch. |
| Forms | `components/ui/ActionForm.tsx` | Submits to a Server Action and shows the action's own answer as a toast. It resets only on success, so a refused form keeps what you typed. |
| Actions | `src/server/actions/*.ts` | **Every write in the app.** Each one is a public POST endpoint, so nothing it receives is trusted (`input.ts`: `str`, `int`, `oneOf`, `isId`, `dateField`, `phoneField`). It returns `succeeded(...)` or `failed(...)` with the reason. |
| Workflows | `src/server/workflows/*.ts` | The cross-module plumbing: invoicing, the accounting ledger, stock movements, messaging, bookings, warranty claim intake. |
| Store | `src/server/store.ts` | `readCollection`, `readMany`, `insertRow`, `updateRow`, `upsertRow`, `deleteRow`. These are Supabase only, with a retry for token clock skew. |
| Rules | `src/lib/*.ts` | Pure functions shared by screens and actions: GST, quotes, finance (EMI), insurance, RTO, service schedule, SLA, warranty, permissions. |
| Module map | `src/lib/modules.ts` | **The single source of truth** for the sidebar, page headers, breadcrumbs, the command palette and `GET /api/v1/modules`. |

A database refusal never becomes an error page. `actions/outcome.ts` wraps
every action, so a failed write toasts **"That change was not saved"**. The
toast is always the database's answer, never an assumption.

---

## 3. Data

### Storage

- **Supabase is the only copy of the data.** Each collection is one
  `sim_<name>` table shaped `(id text, data jsonb, created_at)`. Nothing is
  bundled in the code; an empty table shows as empty.
- The `sim_` prefix lets the simulation share the CRM's Supabase project
  without touching production tables. RLS is on, and only the server's
  service-role key can read or write.
- `npm run db:setup` creates the tables from `supabase/schema.sql`. Every
  statement is `if not exists`, so re-running it never touches existing rows.

### Collections (42)

| Area | Collections |
|---|---|
| CRM | `leads`, `lead_remarks`, `segments`, `enquiries`, `deals`, `bookings`, `follow_ups`, `campaigns`, `landing_pages`, `test_drives`, `tickets` |
| Dealer network | `applications`, `kyc_documents`, `dealers`, `compliance` |
| Product & retail | `products`, `quotations`, `tax_invoices`, `financiers`, `finance_cases`, `insurance_policies`, `deliveries`, `registrations` |
| Stock & orders | `vehicle_units`, `spare_parts`, `inventory_logs`, `orders`, `invoices`, `part_orders` |
| After-sales | `job_cards`, `warranty_claims` |
| ERP | `documents`, `roles`, `approvals`, `users`, `ledger_mappings`, `sync_queue`, `connectors`, `messages`, `message_templates`, `payments`, `telematics` |

Field names follow the production EV-CRM Prisma schema, so pointing the store
at the real tables later is a query change, not a rewrite.

### Ids and document numbers

- **Row ids:** a prefix plus time plus random, e.g. `WCL-M1X2AB3C`
  (`server/ids.ts`).
- **Document numbers:** `PREFIX/YY/NNNN`, always one past the highest number
  already used (`server/numbering.ts`), so numbers never repeat. Examples:
  `PO/26/2301` (dealer order), `INV/26/7701`, `WC/26/901` (warranty claim),
  `WCN/26/401` (warranty credit note).
- **E-invoice IRN:** the real SHA-256 over GSTIN, financial year and invoice
  number, so a simulated IRN has the correct 64-character shape.

### What is never deleted

A dealership's books are append-only, and the simulation keeps that rule:

- Tax invoices, bookings, orders, loans, policies, job cards and claims are
  **cancelled, rejected or closed**, never removed.
- Inventory logs, the accounting queue, the message log, payments and
  registrations cannot be edited.
- Deleting is refused when something downstream would be orphaned, and the
  toast says what to do instead.

---

## 4. The modules (client's list: 32)

### Customer Relationship Management

| Module | Route | What it actually does |
|---|---|---|
| Lead Master | `/crm/leads` (+ `[id]`) | Add, edit and delete leads, or **import a CSV** (validated row by row, duplicates refused). The score is **computed** as EV-CRM computes it. Each lead has a timeline of notes. See section 9. |
| Unassigned / Assigned Leads | `/crm/leads/unassigned`, `/assigned` | **Route to the nearest dealer** (one lead or all of them) or assign by hand; advance status, **convert to a deal** or mark lost. |
| Segments | `/crm/leads/segments` | Saved filters whose contact counts are computed live on every render. |
| Enquiry Management | `/crm/enquiries` | Open → Responded → Quoted → Closed, or convert to a lead. |
| Test Drive Scheduling | `/crm/test-drives` (+ `[id]`) | Book a demo-vehicle slot with no double-booking (Mon–Sat, 9–6 IST), check the licence, record feedback. Feedback moves the lead's score and can create a follow-up. |
| Pipeline Board | `/crm/pipeline` | Deals move Qualified → Demo → Quotation → Negotiation → **Booked**. Booking a deal creates the DMS booking. |
| Bookings | `/crm/bookings` | Confirmed → Awaiting Finance → Ready for Delivery → Delivered (only through a handover). Cancelling releases the vehicles and withdraws the loan and policies. |
| Customer Follow-ups | `/crm/follow-ups` | Due → Overdue → Done; reschedule. |
| Campaign Master / Landing Pages | `/crm/campaigns` (+ `[id]`), `/landing-pages` (+ `[id]`) | A campaign targets a saved segment and is **sent** through the WhatsApp/SMS connectors on an approved template. Results are **measured**: delivery from the message log, then deals, bookings and ROI from what the audience did afterwards. Landing pages carry EV-CRM's `uniqueId`; a captured submission becomes an attributed enquiry (retail) or onboarding application (dealership). See section 11. |
| Customer Support & Ticketing | `/crm/support` (+ `[id]`) | P1–P4 tickets with first-response and resolve SLAs, escalation to the RM, WhatsApp replies, CSAT on close, links to warranty claims. |

### Dealer Management System

| Module | Route | What it actually does |
|---|---|---|
| Onboarding Pipeline / KYC | `/dms/onboarding` (+ `[id]`), `/kyc` | Enquiry → Documents → Verification → Approval → Agreement. Each stage has EV-CRM's document checklist, and every required document must be verified to move on. Approval is a sign-off in the approvals queue. A deposit and a signed agreement **create the dealer** with a credit limit. See section 8. |
| Dealer 360 / Compliance | `/dms/dealers` (+ `[id]`), `/compliance` | Dealer cards (targets, outstanding, health) and a page per dealer. Compliance follows EV-CRM: status computed from expiry (renewal window 45 days), issue date and notes, a renewal history, WhatsApp renewal reminders (single or all due), and each dealer's file completeness. **An expired dealer agreement or trade licence puts the dealer on compliance hold: no new orders** (simulation policy). |
| Vehicle Stock | `/dms/inventory/vehicles` | One row per chassis: In Stock → Allocated → In Transit → Delivered. **OEM stock** (any location that is not a dealership) is shown apart from dealer stock. **Receive from production** puts built vehicles into OEM stock at the plant. Vehicles reserved to a dealer order link to it. |
| Spare Parts / Inventory Logs | `/dms/inventory/spare-parts` (+ `orders`, `orders/[id]`), `/logs` | The catalogue: receive parts against a GRN, count and write off stock. **Dealer parts orders** follow EV-CRM's spare-part requests: Requested → stock check (picked off the shelf, or **Short** with a notice, re-check or part shipment with a back-order) → Dispatched with an 18% GST invoice on the dealer's account → Delivered. The log is a read-only ledger written by every module that moves stock. |
| Quotation & GST Invoicing | `/dms/quotations` (+ `[id]`, invoices, price list) | A quote built off the price list with GST split by place of supply and the PM E-DRIVE subsidy. A discount over 3% goes to approval; an accepted quote converts to a booking. |
| Order Management | `/dms/orders` (+ `[id]`, `short`) | A dealer order moves Placed → **stock check** → Acknowledged (vehicles reserved) → In Production → **Dispatched** → Received. An order stock cannot cover goes **Stock Short**: out-of-stock notice, re-check, or ship part and back-order the rest. Analytics by zone and week. See section 10. |
| Billing & Invoices | `/dms/orders/invoices` (+ `[id]`, `dealers/[id]`) | Receivables: status computed from balance and due date, ageing buckets, a printable invoice, a dealer statement with running balance, credit limits and holds, receipts (one invoice or on account, oldest first), credit notes, WhatsApp reminders. See section 7. |
| Vehicle Delivery | `/dms/orders/delivery` (+ `[id]`) | Allocate the oldest stock, a 10-point PDI per chassis, dispatch with gate pass and e-way bill, and a WhatsApp **OTP handover**. |
| Finance & Insurance | `/dms/finance-insurance` (+ `[id]`) | Loan with the NBFC panel: documents → sanction → disbursal (UTR). Insurance compared across six insurers, issued per chassis. Dealer payouts. |
| RTO & Registration | `/dms/rto` (+ `[id]`) | Temporary registration valid 30 days, Forms 20/21/22, Vahan filing, objections, the registration number, HSRP, RC. |
| Service Job Cards | `/dms/service/jobcards` (+ `[id]`) | Complaint / cause / correction, labour and parts off stock, each billed to the customer, a free service or warranty. |
| Warranty Claims | `/dms/service/warranty` (+ `[id]`) | Coverage check, **auto-adjudicated** intake, review, repair, reimbursement and supplier recovery. See section 6. |

### ERP & core integrations

| Module | Route | What it actually does |
|---|---|---|
| Document Management | `/erp/documents` | Every KYC file, agreement and invoice in one register. |
| Role-Based Access & Approvals | `/erp/access` | Roles with live headcounts; the **approval queue**, whose decisions carry through to the record. |
| Dashboards, MIS & Analytics | `/erp/analytics` | Network MIS: sales, stock, collections, service. |
| ERP / Accounting Integration | `/erp/accounting` (+ ledgers, reconciliation) | The voucher queue, ledger mapping, replay, and DMS-vs-books reconciliation. |
| API Integrations | `/erp/integrations` | WhatsApp, DLT SMS, payment gateway, telematics, accounting, Vahan, GST IRP and e-way bill connectors. Each one can be switched off. |

Administration (`/admin/notifications`, `/admin/users`, `/settings`) sits
below the client's list and is not counted among the 32.

---

## 5. How modules hand work to each other

This is the part to show a client. Each step below is **one click**, and it
writes to every module listed.

### The retail journey: lead to registered vehicle

| # | Click | Where | What it writes |
|---|---|---|---|
| 1 | Landing-page enquiry → **Convert to lead** | Enquiries | `leads` row; the enquiry is closed |
| 2 | **Assign** owner and dealer | Unassigned Leads | lead status advances; it leaves the unassigned list |
| 3 | **Book a test drive** → feedback | Test Drives | slot taken on the demo vehicle; note on the lead's timeline; score moves; a follow-up for a keen customer |
| 4 | **Convert to deal** | Assigned Leads | `deals` row in Qualified |
| 5 | **Quote** | Pipeline | `quotations` row taxed by place of supply. A discount over 3% creates an `approvals` row first. |
| 6 | Approve the discount | Role-Based Access | the quotation is sent to the customer on WhatsApp (`messages`) |
| 7 | **Convert to booking** | Quotation | `bookings` row, a payment link for the 10% token (`payments`). This is the CRM → DMS handoff. |
| 8 | Loan: documents → sanction → **disburse** | Finance & Insurance | `finance_cases`; disbursal moves the booking to Ready for Delivery |
| 9 | **Insure** each chassis | Finance & Insurance | `insurance_policies`; commission accrues to the dealer |
| 10 | Allocate → PDI → **Dispatch** | Vehicle Delivery | `vehicle_units` Allocated; gate pass, e-way bill (needs that connector up), OTP on WhatsApp |
| 11 | Enter the **OTP** | Vehicle Delivery | booking Delivered; stock out (`inventory_logs`); GST **tax invoice** (`tax_invoices`, with IRN for B2B); sales voucher (`sync_queue`); TP issued (`registrations`); telematics unit activated (`telematics`) |
| 12 | Forms → Vahan → **Approve** | RTO | the registration number is written back onto the vehicle; HSRP; RC |

### The dealer supply journey

| Click | Where | What it writes |
|---|---|---|
| Sign the dealer agreement | Onboarding | `dealers` row (credit limit = 4 × deposit, 30 days), its `compliance` file, a WhatsApp welcome to the applicant |
| Receive from production | Vehicle Stock | `vehicle_units` In Stock at the plant; `inventory_logs` IN (Production) |
| Place an order | Order Management | refused while the dealer is on **compliance hold**; otherwise an `orders` row with lines. Over the dealer's credit limit, it goes **on credit hold** with a Credit Limit `approvals` row; approving releases it, rejecting cancels it. |
| **Check stock & confirm** | Order Management | free OEM stock covers every line → those `vehicle_units` are **reserved** (Allocated to the order) and the order is Acknowledged; otherwise the order is **Stock Short** |
| **Dispatch** | Order Management | `invoices` (order value + 5% GST, due on the dealer's credit days); the dealer's outstanding rises; the **reserved** `vehicle_units` go In Transit to the dealer; `inventory_logs` OUT; a sales voucher |
| **Mark received** | Order Management | the vehicles go In Stock at the dealer; `inventory_logs` IN |
| Record a receipt | Billing & Invoices | the invoice's balance falls; the dealer's outstanding falls; a receipt voucher. A gateway payment captured under API Integrations does the same. |
| Raise a credit note | Billing & Invoices | balance and outstanding fall; a Credit Note voucher reversing the sale and its GST |

### The after-sales journey

| Click | Where | What it writes |
|---|---|---|
| **Open a job card** by chassis | Job Cards | owner, dealer and history found from the sale |
| Issue parts | Job Cards | `spare_parts` on-hand falls; `inventory_logs` OUT |
| **Close** | Job Cards | 18% GST service invoice for the customer's share; the warranty share is filed as a **warranty claim through the rules engine**; next service date and km set |
| Work the claim | Warranty Claims | see section 6 |

### What every step feeds automatically

| Feeds | Built from | So that… |
|---|---|---|
| **Notification bell** (`server/notifications.ts`) | Live rows, recomputed on every render and never stored | an overdue invoice, an expired licence or a claim waiting on review appears the moment the data says so, and disappears when it is dealt with |
| **Dashboard and MIS** (`server/analytics.ts`) | The same collections | the figures can never disagree with the screens |
| **Accounting queue** (`workflows/ledger.ts`) | Every invoice, receipt, payout and credit note | each one queues a voucher that posts only when the accounting connector is up **and** every ledger it touches is mapped. Otherwise it fails with the reason and waits for replay. |
| **Inventory Logs** (`workflows/stock.ts`) | Every module that moves stock | the stock ledger always matches the stock it explains |
| **Message log** (`workflows/messaging.ts`) | Quote shares, OTPs, service reminders, ticket replies | when the WhatsApp connector is off, messages bounce, as they would in real life |

---

## 6. Warranty Claims in depth

This module was rebuilt to match EV-CRM's warranty module (its
`warranty.controller.ts` and `warrantyAdjudication.service.ts`).

### 6.1 Policy

- **Battery and motor** carry the model's published warranty from the price
  list's *Warranty* column, e.g. 3 years / 80,000 km on the LX Spark.
- **Controller, charger and harness** follow the simulation's own policy:
  - Controller: 24 months / 50,000 km
  - Charger: 12 months
  - Harness: 12 months / 30,000 km
- **The battery** is covered when its state of health falls **below 70%**,
  and only if it was charged on an approved Luxus Green charger.
- **Cover starts at handover**, read from Vehicle Delivery.

All of this lives in `src/lib/warranty.ts`.

### 6.2 Coverage check

Type a chassis number on Warranty Claims. You get every component's term, its
cover end date, and whether it is in warranty, ending soon, expired or over
the km limit, judged against the live telematics odometer.

### 6.3 Intake and the rules engine

A claim arrives either from the **Raise a claim** form or by **closing a job
card** with warranty work. Both go through the same `fileClaim()` in
`server/workflows/warranty.ts`, just as the CRM shares one function between
staff intake and the dealer portal.

**The evidence is gathered first:**
- **Handover date:** from Vehicle Delivery.
- **Service history:** closed job cards. Were the free services that fell due
  actually done?
- **Odometer and battery SoH:** the dealer's readings, or, when left blank,
  the vehicle's **telematics unit**.
- **Duplicates:** any other open claim on the same component of the same
  chassis.

**Then the rules run.** These are the CRM's Appendix B rules, line for line:

| Check | Broken → | Missing evidence → |
|---|---|---|
| Months since handover ≤ term | **Void** | Needs review |
| Odometer ≤ term km | **Void** | Needs review |
| Battery SoH below the 70% floor | **Void** (a healthy battery is not a capacity claim) | Needs review |
| Charger on the approved list | **Void** | Needs review |
| Free services done | **Void** | (taken as complete if the vehicle has no history in the network) |
| No other open claim on the component | — | Needs review (possible duplicate) |

**What the result does to the claim:**

| Result | Claim status |
|---|---|
| **Auto-approve** | Approved for the full amount |
| **Void** | Rejected with the broken rules as the reason |
| **Needs review** | Under Review, for a person to decide |

Every check writes a sentence. The claim page shows them as a ✓ / ⚠ / ✗
checklist, so the decision is evidenced rather than argued.

### 6.4 Lifecycle

```
Submitted ─▶ Under Review ─▶ Approved ─▶ In Repair ─▶ Reimbursed ─▶ Recovery ─▶ Closed
     │            │  ▲                      │                                (Recovered or Written Off)
     │            ▼  │                      └─ failed battery / motor / controller
     │      Info Requested                     must come back before reimbursement
     └──────────▶ Rejected ─▶ (Reopen) ─▶ Under Review
```

- **Request info:** the dealer's answer (new readings, charger, a note)
  re-runs the rules. Their verdict goes back to the reviewer as a
  recommendation; once a person has looked at a claim, a person decides it.
- **Approve** in full or in part. **Reject** needs a reason the dealer sees.
- **Reopen** a voided claim for goodwill, or when there is evidence the rules
  did not have.
- **Reimburse:** a credit note `WCN/26/…` to the dealer, posted to the books
  as a Credit Note voucher (*Warranty expense* / *Sundry debtors — dealers*).
  The *Warranty expense* ledger is added **unmapped** the first time, so that
  voucher is refused until someone maps it under ERP / Accounting and replays
  it, as a real Tally integration behaves.
- **Recovery:** open a case against the component's supplier for up to the
  approved amount, then close it as **Recovered** (with the debit note) or
  **Written Off** (with a reason).

### 6.5 Analytics

The list screen shows:
- **Awaiting a person**
- **Decided by the rules:** the auto-approve-or-void rate
- **Approved cost**
- **Net cost** after supplier recoveries

The side panels show **cost by component, by model and by supplier**, the
CRM's cost analytics.

---

## 7. Billing & Invoices in depth

This module follows EV-CRM's receivables rules (`receivables.service.ts`).
The arithmetic lives in `src/lib/receivables.ts`; everything that moves money
goes through `src/server/workflows/receivables.ts`.

- **Status is computed, never stored.** Balance = invoiced − received −
  credited. An invoice with a balance past its due date is **Overdue**
  whenever it is read, so the ageing can never go stale.
- **Ageing** uses the CRM's buckets by days since issue: up to 30, 31–60,
  61–90, over 90.
- **One receipt path.** A receipt typed in against an invoice, a receipt on
  account, and a gateway payment captured under API Integrations all go
  through the same `applyReceipt()`. Each one:
  - lowers the invoice's balance
  - lowers the dealer's outstanding (shown in Dealer 360)
  - queues a Receipt voucher
  - is refused if its UTR is already recorded
- **On account, oldest first.** A lump receipt from a dealer is spread across
  its open invoices oldest first (FIFO), as a ledger books it.
- **Credit notes** (`DCN/26/…`) reduce an invoice and the dealer's outstanding,
  and post a Credit Note voucher reversing the sale and its GST.
- **Credit control.** Each dealer has a credit limit and days to pay, set on
  its statement page. New invoices fall due on those days (30 by default).
  An order whose value plus GST would take the dealer past its limit is
  placed **on credit hold**:
  - a Credit Limit request goes to the Finance Controller in the approvals
    queue, and the order cannot be acknowledged meanwhile
  - approving releases the order; rejecting cancels it
- **Reminders** go to the dealer's active login on WhatsApp. Use one invoice,
  or **Remind all overdue**, which skips any invoice reminded in the last
  three days. The `payment_reminder` template is added **pending** the first
  time, so the first reminders fail until it is approved under API
  Integrations → Templates.
- **Pages:**
  - the list, with ageing, dealer exposure and filters by state
  - each invoice as a printable GST document, with its receipts, credit notes,
    reminders and vouchers
  - each dealer's statement, with its running balance

---

## 8. Dealer Onboarding in depth

This module follows EV-CRM's onboarding controller and its document catalog
(`applicationRouting.service.ts`). The rules are in `src/lib/onboarding.ts`;
the actions are in `src/server/actions/onboarding.ts`.

| Stage | CRM stage | Documents to verify before moving on | Time limit* |
|---|---|---|---|
| Enquiry | Screening & NDA | Signed NDA, Expression of Interest, CIBIL reports | 5 days |
| Documents | Business proposal | Detailed project report, 3-year projections, funding proof | 14 days |
| Verification | Due diligence + KYC | Audited financials, ITRs, 12 months' bank statements, net worth certificate, property, fire NOC, site media (plans and bank NOC optional), **plus all six Digital KYC documents** | 10 days |
| Approval | — | Sign-off by the Head of Network Development in the approvals queue | 3 days |
| Agreement | Legal agreement | Letter of Intent, dealership agreement, security deposit proof (board resolution optional) | 14 days |

*Time limits are simulation policy.

- **Gates.** Moving on is refused until every required document of the
  current stage is verified. The toast lists what is missing. A document is
  received, then verified, or rejected with what is wrong; a rejection is sent
  to the applicant on WhatsApp.
- **Sign-off.** Entering Approval raises a Dealer Onboarding request.
  - Approving moves the application to Agreement and seeds its checklist.
  - Rejecting closes the application with the reason.
- **Deposit and signing.** The security deposit (at least ₹5 L for a dealer,
  ₹15 L for a distributor, ₹2 L for a service partner; simulation policy) is
  recorded with its UTR. Signing needs the deposit and the agreement file
  verified. It creates the dealer on Dealer 360 with:
  - a **credit limit of four times the deposit** and 30 days to pay, which
    Billing & Invoices then enforces
  - its compliance file
  - a WhatsApp welcome to the applicant
- **Hold, reject, resume** record the reason in the history, and the
  applicant is told. The `application_update` template is added pending the
  first time, the same honest behaviour as the payment reminders.
- **Stalled** applications (past their stage's limit) are flagged on the
  pipeline and reach the notification bell.
- **Older applications** without a checklist get one the first time they are
  moved on, and must complete it.

---

## 9. Leads in depth

The rules are in `src/lib/leads.ts`, ported from EV-CRM's
`leadScoring.service.ts`, `findNearestDealer` and `leadsImport.controller.ts`.

- **Score.**
  - Profile completeness: seven fields (name, phone, email, city, state,
    pincode, model of interest), about 14.3 points each.
  - Weighting: completeness counts 70% and contact quality 30%. Quality
    starts at 100 and loses 10 for a malformed email or phone.
  - The result is the lead's **base** score. A test drive's feedback moves the
    score on top of it. Editing the profile re-scores the base and keeps that
    engagement.
  - The lead page shows the breakdown and what is missing.
- **Duplicates.** A second lead with the same mobile or email is refused, on
  add, on edit and on import.
- **Routing to the nearest dealer**, in order:
  1. an active dealer in the lead's city
  2. otherwise one in its state (a lead with no state takes the state of a
     dealer in its city)
  3. between equals, the higher tier
  4. then the dealer with the **fewest open leads**

  The owner is the active salesperson with the fewest open leads. "Route all"
  works through the unassigned leads from the highest score down, so load
  balances as it goes. The reason (for example "same city (Raipur) · Gold · 2
  open leads") is kept on the lead.
- **CSV import.**
  - Up to 1,000 rows and 1 MB; a template is at `/templates/leads-import.csv`.
  - Columns go by header in any order.
  - Each row needs a name and a phone or email.
  - Phone, email, pincode and state are validated, and duplicates are refused
    against the database **and within the file**.
  - Rows that pass are scored and, if asked, routed. The toast lists every
    skipped row with its reason.

---

## 10. Order Management in depth

This module follows EV-CRM's Order Management "Check Inventory / Close
Orders" flow (`orderManagement.controller.ts`). The rules are in
`src/lib/stock.ts`.

- **OEM stock** is any in-stock vehicle whose location is not a dealership.
  Usually that is the plant, filled by **Receive from production** on Vehicle
  Stock.
- **Check stock & confirm** (what used to be "Acknowledge") compares every
  line of the order with free OEM stock of that model and variant.
  - **Covered:** the vehicles are **reserved** to the order (oldest stock
    first), so no other order or retail delivery can take them, and the order
    is Acknowledged.
  - **Not covered:** the order becomes **Stock Short** and goes on the
    short-of-stock list.
- **Short of stock** (`/dms/orders/short`, a tab of Order Management):
  - Orders are grouped by the model and variant they are competing for.
  - Each group is ranked **best fit**: the smallest shortfall against *live*
    stock first, then the larger order.
  - From the list or the order, you can **Re-check** (confirms once stock has
    arrived) or **Ship what's in stock**. Shipping cuts the order to what is
    in stock, confirms it, and turns the rest into a **back-order** linked
    both ways.
  - You can send an **out-of-stock notice**: an expected restock date, a
    message, and optionally an offer of what can ship now. It goes to the
    dealer's login on WhatsApp; the `stock_notice` template is added pending.
  - A short order with no notice sent reaches the notification bell.
- **Dispatch** ships the reserved vehicles to the dealer. Orders confirmed
  before stock checks have nothing reserved, so their vehicles are still
  built to order.
- **Cancel** releases any reserved vehicles back into OEM stock.
- **Analytics** on the list: units ordered by dealer state with the
  most-ordered model, orders per week for eight weeks, average age of open
  orders, and the fulfilment rate.

---

## 11. Campaigns and landing pages in depth

This follows EV-CRM's campaign management and landing-page campaigns. The
measurement rules are in `src/lib/campaigns.ts`; the actions are in
`src/server/actions/campaigns.ts`.

- **A campaign** is WhatsApp, SMS, Email or Landing Page.
  - Messaging campaigns target a **saved segment** (computed live, as
    always) and go out on a named **template**.
  - **Send** messages every member the channel can reach, once per phone or
    email, up to 2,000.
  - WhatsApp and SMS go through the real messaging workflow: each message is
    in the message log and **fails if the connector is off or the template
    is not approved**.
  - Email has no connector here, so its sends are recorded.
  - The send snapshots who it went to.
- **Results are measured, never typed in.**
  - Delivery (sent, delivered, read, failed) comes from the message log.
    Delivery reports move it on.
  - Outcomes are what the audience did **after the send**: leads that moved
    to Qualified or beyond, test drives, deals, bookings and their value.
  - The campaign page shows cost per deal, cost per booking and return on
    spend.
  - A landing-page campaign is measured on everything its page produced.
  - Campaigns from before this show their typed figures, labelled as such.
- **Landing pages** get a `uniqueId` (the id the external page posts back
  with every submission), an intent (retail, dealership or both) and an
  optional GTM container. The page's own page shows:
  - **Funnel:** visits → submissions (conversion %) → enquiries and
    applications → leads → test drives → deals → bookings.
  - **Capture a submission:** stands in for the live page's webhook, routed
    by intent as EV-CRM's ingest does. A retail submission becomes an enquiry
    with the **nearest dealer**. A dealership submission opens an onboarding
    application with its checklists.
  - **Attribution** carries through: enquiry → lead (on conversion) → deal →
    booking.
  - **Visits** from the page's analytics can be added, so the conversion rate
    has a base.

---

## 12. Simulated integrations

Nothing leaves the app. Every connector behaves as the real one would,
**including failing when it is switched off** under API Integrations:

| Connector off | What happens |
|---|---|
| WhatsApp / SMS | messages, the handover OTP included, are logged as Failed and wait for a retry |
| Payment gateway | payments cannot be captured |
| Accounting | vouchers wait in the queue (Queued), then post on replay |
| Vahan | RTO filings are refused |
| GST IRP | B2B invoices wait for their IRN |
| E-way bill | dispatch is refused |
| Telematics | the readings refresh is refused |

---

## 13. Business rules and where they come from

| Rule | Source | File |
|---|---|---|
| Models, specs, published warranty | luxusgreen.com product pages | `products` rows, `lib/vehicles.ts` |
| NBFC panel, rates, EMI | luxusgreen.com/finance | `lib/finance.ts` |
| GST 5% on EVs, 18% on parts and labour; CGST+SGST vs IGST; IRN | GST law | `lib/gst.ts` |
| PM E-DRIVE incentive | MHI notifications | `lib/quotes.ts` |
| TP 30 days; Forms 20/21/22 | Central Motor Vehicles Rules | `lib/rto.ts` |
| Free-service schedule, labour rate, SLA hours, discount limit, warranty split by component, SoH floor | **Simulation policy** (Luxus Green publishes none) | `lib/service.ts`, `lib/sla.ts`, `lib/quotes.ts`, `lib/warranty.ts` |

Every policy figure lives in one file under `src/lib/` and is labelled as
policy on screen.

---

## 14. What it does **not** do

- **No sign-in.** The demo acts as one fixed operator (Akash Menon, System
  Admin). Roles and permissions are **recorded, not enforced**.
- **No file storage.** Dealer images are stored inline as resized data URLs.
  Bills and evidence are typed in, not uploaded or OCR-read.
- **No outside calls.** All integrations are simulated (see section 12).
- **No seed data.** The tables start empty unless they were filled through
  the app.

---

## 15. A 15-minute demo script

1. **Dashboard:** the network at a glance. Open the bell to show what needs
   a human right now.
2. **Landing Pages:** create a page that takes both retail and dealership
   submissions, publish it, then capture one of each. One lands as an
   enquiry with the nearest dealer, the other as an onboarding application,
   both attributed to the page. Then go to **Campaign Master**: create a
   WhatsApp campaign on a segment and send it. Show the message log and the
   results panel.
3. **Lead Master → Import leads** with the template CSV. Duplicates and bad
   rows are skipped with their reasons, and the rest are scored and routed to
   their nearest dealers. Then **Enquiries → Convert to lead → Book a test
   drive.** Show the note landing on the lead's timeline and the score moving.
4. **Pipeline → Quote** with a 5% discount. It goes to **Role-Based Access**;
   approve it there.
5. **Convert to booking → Finance & Insurance:** sanction and disburse the
   loan, insure the chassis.
6. **Vehicle Delivery:** allocate, PDI, dispatch, enter the OTP. Then show,
   in this order:
   - the **tax invoice**
   - the vehicle **Delivered** in stock
   - the **TP** under RTO
   - the telematics unit
   - the **sales voucher** under ERP / Accounting
7. **API Integrations:** switch off **Accounting**, record a dealer receipt,
   and show the voucher waiting. Switch it on and **replay**.
8. **Job Cards:** open one on the delivered chassis, add a warranty part,
   close it. A **warranty claim** appears, already adjudicated. Open it and
   walk through the rules checklist.
9. **Warranty Claims:**
   - Run a **coverage check** on the chassis.
   - Raise a battery claim with SoH 85%. It is **voided** (healthy battery).
   - Reopen it, approve it, start the repair, receive the part.
   - **Reimburse.** The credit note's voucher is refused, because *Warranty
     expense* is unmapped. Map the ledger, replay, then **recover** from the
     supplier.
10. **Order Management:**
   - **Vehicle Stock → Receive from production** 5 × LX Spark at the plant.
   - Place a dealer order for 8.
   - **Check stock & confirm.** The order is short; open **Short of stock**.
   - Send the notice with a restock date.
   - **Ship what's in stock.** 5 are reserved and confirmed, and 3 become a
     back-order.
   - Dispatch the 5 (invoice + those exact chassis in transit), then receive
     them.
11. **Onboarding:**
    - Open an application.
    - Try **To Documents** — refused, with the missing NDA, EoI and CIBIL
      listed. Receive and verify them, and it moves.
    - At Approval, approve the sign-off in the queue.
    - Record the deposit and verify the agreement file.
    - **Sign.** The dealer appears on Dealer 360 with a credit limit.
12. **Billing & Invoices:**
    - Open the dealer's statement and set a credit limit below what it owes.
    - Place another order. It goes **on credit hold**; approve it in the
      approvals queue.
    - Record a receipt on account and watch it settle the oldest invoices.
    - Raise a credit note.
    - **Remind all overdue.** The reminders fail until the template is
      approved under API Integrations → Templates.

---

## 16. Running it

```bash
cp .env.example .env        # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
npm install
npm run db:setup            # creates the sim_* tables; safe to re-run
npm run dev                 # http://localhost:3003
```

Checks:

```bash
npm run typecheck
npm run lint
npm run build
```

HTTP API, for integrations rather than the UI:

| Route | |
|---|---|
| `GET /api/v1/health` | Up, and can it read the database? |
| `GET /api/v1/modules` | The module map |
| `GET /api/v1/dashboard` | Every figure the dashboard shows |
| `GET /api/v1/collections/:name?q=&limit=&offset=&format=csv` | Any collection, searchable, exportable |
