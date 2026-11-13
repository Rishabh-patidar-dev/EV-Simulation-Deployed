# EV-Simulation

One dashboard covering the **entire** module list the client shared — CRM, DMS and
ERP — in a single Next.js app.

This is deliberately different from the rest of this repo. `EV-CRM-`, `Ev Landing`
and `DMS` are three separately deployed apps that talk to each other over HTTP,
each with its own dashboard. Here, a lead captured in CRM, an order raised in DMS
and an invoice settled in ERP all live behind one rail, and requests move
**between modules, never between dashboards**.

```
npm install
npm run dev     # http://localhost:3003
```

It needs a Supabase project in `.env` — see *Data* below.

## Stack

| | |
|---|---|
| Front end | Next.js 16 (App Router), React 19, Tailwind v4 |
| Back end | TypeScript — route handlers under `src/app/api/v1`, domain code in `src/server` |
| Database | Supabase (the same project the CRM and landing page use), `sim_*` tables |

Screens are React **server** components that call `src/server/store.ts` directly,
so a page render is one round trip rather than a browser fetch. The HTTP API
exists alongside them for integrations, not to paint the UI.

## The module map is a data file

`src/lib/modules.ts` is the single source of truth. The sidebar, every page
header, the command palette and `GET /api/v1/modules` all render off it, so what
the client sees can never drift from what was agreed.

**All 32 modules on the client's list are built**, each a working screen backed
by real data, and every one is on the sidebar. A module added later needs an
entry here and a route.

Three carry `underDevelopment: true` — **Customer Support & Ticketing**,
**Quotation & GST Invoicing** and **RTO & Registration (TP)**: built, but not finished. The rail shows a **red dot** against them (and
against a closed group that hides one), the palette and their screens say
"Under development" beside the title, and `GET /api/v1/modules` reports the
flag. Clearing one is a one-line change here.

Nothing in this app talks to a real outside system (see **API Integrations**
under "Dealer network & ERP"), so the marker says only that the work is
unfinished — it makes no claim about which module is wired to what.

## Creating, editing and deleting

Every record a person enters by hand can be created, corrected and removed
from the screen it lives on: leads (and the notes on their timeline),
enquiries, deals, segments, follow-ups, campaigns, landing pages, dealer
applications (with their KYC checklist), dealer compliance documents, spare
parts, financiers, vehicle models with their specification and variants,
message templates, users and draft quotations.

Correcting means the record's own fields, not only its status: a follow-up's
subject, owner and channel; a campaign's name, channel and spend; a landing
page's name and slug; an application's firm, city, state and owner (the KYC
checklist follows the firm's new name); a part's name, category and location; a
model's segment, body type and specification (its HSN follows the body type, so
an invoice stays right). A model's **name** is the exception: quotations, dealer
orders and stock all carry it as text, so once it has been sold against the name
is fixed and only the specification moves.

What a dealership's books must keep is **never** deleted. A tax invoice is
cancelled, a booking or an order is cancelled, a loan is withdrawn, a policy is
cancelled, a claim is rejected, a job card is cancelled, a document is
archived, a dealer or a model is suspended or taken off the list — each leaves
the row and its history in place. Inventory logs, the accounting queue, the
message log, payments and registrations are append-only for the same reason.

Deleting is also refused when something downstream would be orphaned, and the
toast says what to do instead: a lead with a deal, a quotation or a test drive
is marked lost; a campaign that has reached people stays; a part that has been
issued to a job card stays; a financier with a loan case is taken off the panel;
a model that has been quoted is taken off the price list. Deleting a lead takes
its notes with it and puts the enquiry that produced it back to Open.

## CRM is fully interactive, not just a viewer

Every CRM screen writes as well as reads — this is the part of the simulation
that reproduces how the real EV-CRM / DMS ecosystem's modules act on each
other, inside one app instead of across three deployments:

- **Lead Master** — add a lead or **import a CSV** (validated row by row,
  duplicates by phone or email refused, every skipped row explained). The
  **score is computed** as EV-CRM computes it — profile completeness 70%,
  contact quality 30% — with engagement such as test-drive feedback on top.
  Every lead name opens a **lead detail page** (`/crm/leads/[id]`) with the
  score breakdown and a real activity timeline.
- **Unassigned Leads** — **route to the nearest dealer** (same city, then
  state, then tier, then the lightest load; one lead or all at once) or
  assign an owner + dealer by hand.
- **Assigned Leads** — change status, or **Convert to deal** / **Mark lost**.
  Converting creates a real `Deal` row (see below) — not just a status flip.
- **Segments** — `filter` (source / status / city / min score) is a live
  query: a segment's contact count is computed against the leads collection
  on every render, never stored, so it can't go stale.
- **Enquiry Management** — advance Open → Responded → Quoted → Closed, or
  **convert an enquiry straight into a lead**.
- **Pipeline Board** — Advance/revert a deal's stage; **Quote** drafts a GST
  quotation for the deal. Booking a deal (from Negotiation, or by converting
  its accepted quotation) is the **CRM → DMS handoff**: it creates a real
  `Booking` row.
- **Test Drive Scheduling** — book a slot on a dealer's demo vehicle (no
  double-booking, Monday–Saturday 9–6 IST), check the driving licence before
  the keys, and record feedback: it lands on the lead's timeline, moves its
  score, and a keen customer gets a follow-up.
- **Bookings** — Confirmed → Awaiting Finance → Ready for Delivery →
  Delivered. A booking waits on its loan, and completes **only through a
  handover** in Vehicle Delivery (see below); cancelling one releases its
  vehicles, withdraws its loan and cancels its policies.
- **Customer Support & Ticketing** — tickets from phone, WhatsApp, email and
  the web form on luxusgreen.com's own categories, with first-response and
  resolution SLAs by priority, escalation to the region's Relationship
  Manager, a WhatsApp reply to the customer, and CSAT on close.
- **Follow-ups** — create, complete, reschedule.
- **Campaigns** — target a saved segment and **send** through the WhatsApp /
  SMS connectors on an approved template; results are **measured** (delivery
  from the message log; deals, bookings and ROI from what the audience did
  after the send), never typed in.
- **Landing Pages** — EV-CRM's `uniqueId` attribution: a captured submission
  is routed by intent to an enquiry (nearest dealer) or an onboarding
  application, and the page's funnel runs from visits to bookings. See
  `docs/HOW-THE-SIMULATION-WORKS.md` §11.

All of this goes through `src/server/actions/crm.ts` — Next.js Server Actions
behind an `ActionForm` (`useActionState`), with no client-side fetch/JSON
plumbing anywhere. Each action reports what actually happened, so the toast
after a click is the database's answer — "Deal booked — booking BKG/26/4821
created", or "That change was not saved" — never an assumption. Every "create"
form opens as a `<details>`-backed panel (`Disclosure`), which needs no
JavaScript to open or close.

## Retail: quotation to registration

The DMS runs a vehicle sale the way a dealership does, each step writing to
the next:

1. **Quotation & GST Invoicing** — build a quotation off the **price list**
   (model, variant, ex-showroom and dealer price, battery kWh), with extended
   warranty, accessories, registration and insurance. GST is split by place of
   supply (CGST + SGST within the dealer's state, IGST across states) at 5% on
   the vehicle and 18% on the rest; eligible e-rickshaws and e-carts carry the
   **PM E-DRIVE** incentive. A discount over **3%** goes to the approval queue
   before the customer sees it. Accepted → **Convert to booking** (with a
   payment link for the 10% token).
2. **Finance & Insurance** — a loan case with the dealer's NBFC panel:
   documents, submission, sanction with the bureau score, disbursal by UTR.
   Disbursal releases the booking for delivery. Insurance is compared across
   six insurers and issued **per chassis**; the dealer's loan payouts and
   insurance commission are collected and posted.
3. **Vehicle Delivery** — allocate vehicles off stock (oldest first), a
   10-point **PDI per chassis**, then dispatch — which needs every chassis
   insured and raises the gate pass, e-way bill and a WhatsApp **OTP**. The OTP
   completes the handover: the booking is delivered, stock is booked out, the
   **GST tax invoice** is issued (with an IRN for a business buyer), and each
   vehicle gets its temporary registration and a telematics unit.
4. **RTO & Registration** — one file per vehicle: TP valid 30 days (counted
   down), Forms 20/21/22 with insurance, invoice and address proof, filed on
   Vahan, objections answered, the **registration number** written back onto
   the vehicle, HSRP plates, then the RC.

Dealer orders feed the stock this draws on: dispatching an order puts its
vehicles **in transit** to the dealer, and receiving it puts them **in stock**.

## After-sales

- **Service Job Cards** — open by chassis number; complaint, cause and
  correction for each fault; labour at the workshop rate and **parts issued
  straight off spare-parts stock**, each line billed to the customer, a free
  service or warranty. Closing bills the customer's share on an 18% GST
  invoice, raises the **warranty claim** for the rest and sets the next
  service. Service reminders go out on WhatsApp from the "Service due" list.
- **Warranty Claims** — EV-CRM's warranty module: a **coverage check** by
  chassis; intake (typed in, or from a closed job card) that the **rules
  engine adjudicates on arrival** — time and km since handover, battery SoH
  below 70%, an approved charger, free services done, no duplicate — using
  telematics readings when the dealer gives none; request info, approve in
  part or reject, reopen; repair with the failed part returned; the dealer
  **reimbursed by credit note** (posted to the books); **supplier recovery**
  recovered or written off; cost by component, model and supplier. See
  `docs/HOW-THE-SIMULATION-WORKS.md` §6.
- **Spare Parts** — **dealer parts orders** worked like the vehicle order
  desk (stock check and pick, short list with notices and back-orders,
  dispatch with an 18% GST invoice, delivery). Receive stock against a GRN, set reorder levels and prices,
  and edit a part's own details. A **physical count or write-off** is taken on
  the part itself: the counted figure replaces the book figure and the
  difference goes to the ledger with its reason.
- **Inventory Logs** — the stock ledger, and read-only. Every row is written by
  the module that moved the stock (order dispatch and receipt, deliveries,
  workshop issues and returns, receipts and counts in Spare Parts), so the
  ledger always matches the stock it explains. Filters by entity, direction,
  reason and date range are held in the URL, and the movements shown export to
  CSV.

## Dealer network & ERP

- **Onboarding** follows EV-CRM's onboarding controller. Each stage carries
  the CRM's document checklist (NDA, EoI and CIBIL at Enquiry; the business
  proposal; due diligence and the six KYC documents at Verification; LOI,
  agreement and deposit proof at Agreement), and an application moves on only
  when every required document is verified. Approval is a Dealer Onboarding
  sign-off in the approvals queue. **Signing the agreement puts the dealer on
  Dealer 360** with its compliance file and a credit limit of four times its
  security deposit. Hold and reject keep the reason and tell the applicant on
  WhatsApp. Stalled stages reach the bell. Each application has its own page. **Dealer 360** lists the network as cards — image,
  standing, target achievement, what it owes and account health — and has a
  page per dealer (its live orders, bookings, deliveries, jobs and tickets).
  A dealer **image** is picked on either screen: the browser resizes it to a
  256px square and stores it inline, since the app has no object store and the
  CSP allows `data:` images but not remote ones. Compliance documents are
  filed (with issue date and notes), renewed in place — keeping what each
  renewal replaced — and removed; their status follows the expiry date.
  Renewal reminders go to the dealer on WhatsApp, each dealer's file shows
  what is missing, and an expired dealer agreement or trade licence puts the
  dealer on **compliance hold** (no new orders).
- **Approvals** are decided in the queue on Role-Based Access; a decision on a
  discount or a warranty claim carries through to that record.
- **Billing & Invoices** — receivables as EV-CRM runs them: status computed
  from balance and due date (never a stale stored "Overdue"), ageing buckets,
  a printable invoice and a dealer statement with running balance, receipts
  against one invoice or on account (oldest first), credit notes, WhatsApp
  reminders, and per-dealer credit limits and terms — an order over the
  limit goes on credit hold for a Credit Limit approval. See
  `docs/HOW-THE-SIMULATION-WORKS.md` §7.
- **ERP / Accounting Integration** — every dealer invoice, receipt, retail tax
  invoice and payout queues a voucher for the finance system (Tally Prime by
  default). It posts when the connector is up and every ledger it touches is
  **mapped**; failures wait for replay. A **reconciliation** compares each
  dealer's balance in the DMS with the books.
- **API Integrations** (not on the sidebar; open `/erp/integrations`) —
  WhatsApp Business, DLT SMS, payment gateway,
  telematics, the accounting system, Vahan, the GST IRP and the e-way bill
  portal. Every customer message, gateway payment and telematics reading is
  logged. **All of them are simulated** — nothing leaves the app — but each
  flow behaves as it would, including failing when its connector is switched
  off (messages bounce, e-way bills and Vahan filings are refused, vouchers
  queue, B2B invoices wait for their IRN).

## Business rules, and where they come from

| Rule | Source |
|---|---|
| Models, specs (motor, battery, range, payload/seating), 3-year / 80,000 km warranty on the LX Spark | luxusgreen.com product pages |
| NBFC panel (Akasa, Mufin, Credifin, Laxmi India Financecap, Pahal, Rise Wise, Bundela, MAS, Dhara, Bihari Ji); rates from 9.5%, 10% down, 12–60 months, 48–72 h sanction; loan documents | luxusgreen.com/finance — the EMI formula reproduces its worked example |
| Support categories, phone line and hours | luxusgreen.com/support |
| PM E-DRIVE: L5 closed 26 Dec 2025; e-rickshaw/e-cart ₹2,500/kWh capped at ₹12,500 until 31 Mar 2028 | Ministry of Heavy Industries notifications, as reported |
| GST 5% on EVs (HSN 870380 passenger, 870460 goods), 18% on parts and labour (SAC 998714); CGST/SGST vs IGST; IRN for B2B | GST law |
| TP valid one month; Forms 20, 21, 22; battery vehicles exempt from RC fee and permits; green plates | Central Motor Vehicles Rules |

Where Luxus Green publishes nothing — the free-service schedule, labour rate,
SLA hours, discount limit, insurance premiums — the value is the simulation's
own policy, kept in one file under `src/lib/` and labelled as such on screen.

## The shell

The chrome around every screen follows the Ralli Wolf operations console:

- **Rail** — expands to 276px or collapses to a 64px icon strip with tooltips
  (the choice is a cookie, so the server renders the right width and nothing
  jumps); below `lg` it is a sliding drawer. Groups are an accordion and open
  by themselves when the current page is inside them. Search sits at the top of
  the rail.
- **Command palette** — Ctrl K / ⌘K anywhere. Every module on the rail, plus
  actions: add a lead, draft a quotation, book a test drive, log a ticket, open
  a job card or a loan case, place a dealer order, invite a user, theme, collapse the rail,
  refresh data, copy the page link, open help. Fuzzy-ranked, keyboard driven,
  last five runs pinned as Recent. A native `<dialog>`, no modal library.
- **Header** — a system-status menu (where reads and writes go, what is
  disabled), the notification bell and the account menu (who you are, and
  System / Light / Dark). Nothing in it repeats the rail.
- **Notifications** are not stored: each is a row that needs a human right now
  (overdue invoice, expired licence, stale approval…), derived from the same
  collections the screens read, so the bell cannot disagree with the screen it
  links to. Read marks and muted categories live in the viewer's browser.
- **Toasts** confirm every write. CRM forms say what they did; User Management
  forms report the server's answer, including refusals ("that email is already
  in use").
- **Export CSV** on every module screen, and a skeleton while a page renders.

## Order Management

`/dms/orders` runs a dealer order end to end, the way the Ralli Wolf console
runs a purchase order, with EV-CRM's Check Inventory / Close Orders rules:
acknowledging an order checks it against **OEM stock** and reserves the
vehicles; an order stock cannot cover goes **Stock Short** onto its own tab,
ranked best fit, with out-of-stock notices, re-checks and part shipment with
a back-order (see `docs/HOW-THE-SIMULATION-WORKS.md` §10). Place an order with its lines (model, variant, quantity,
dealer price — prices start at each model's average price in stock), then
open it and move it along: **Placed → Acknowledged → In Production →
Dispatched → Received**, or cancel it with a reason before dispatch.

Dispatch is the OEM → dealer handoff and does what the real system would: it
raises the GST invoice (order value + 5%) under Billing & Invoices, queues its
voucher for the books, and puts the vehicles in transit to the dealer —
receiving the order puts them in stock — and the order links to that invoice. Every
step is recorded in the order's history with who moved it and when. The list
filters by status, flags orders past their expected date as **Late**, and feeds
the dashboard, "Needs attention" and the notification bell.

## How it all fits together

`docs/HOW-THE-SIMULATION-WORKS.md` walks through the architecture, the data,
every module, the journeys that cross them, and a 15-minute demo script.

`docs/platform-overview.html` is the same story as flowcharts, for a
non-technical audience — open it in a browser, no build step. Four charts: the
module map, the retail flow from enquiry to a registered vehicle, the dealer
supply flow, and service and warranty — each with the decision points where the
platform refuses, waits or escalates. Then the nine connectors, all 32 modules,
and where each business rule comes from.

## Notifications

The bell in the header, a **Notifications** entry in the sidebar (with the
unread count) and the Notifications page all read one list: every record that
needs a decision right now — late orders, overdue invoices, expired licences,
stale approvals, support tickets past SLA, loans stuck with the lender,
overdue deliveries, temporary registrations about to lapse, job cards past
their promised time, refused accounting vouchers and so on. The page filters by
read state and category, marks items read or unread, and holds the per-category
mute switches. Read marks and mutes are kept per browser (the demo has no
accounts); the notifications themselves are derived from live data, never
stored, so they disappear as soon as the underlying record is dealt with.

## User Management

`/admin/users` lists everyone with access — accounts whose
headcount per role matches the Role-Based Access screen, which now counts them
live rather than storing a number. Invite a user (name, email, role, region,
dealership), filter by role or status, and open anyone to edit their profile,
change their role, or pick exact permissions under the Custom role.
Deactivate, reactivate, resend an invitation or delete — with the guards a real
console has: you cannot remove your own access, and the last active System
Admin cannot be demoted, deactivated or deleted.

The permission catalogue and role presets live in `src/lib/permissions.ts`,
grouped like the rail. **They are recorded, not enforced** — the simulation has
no authentication, and every screen says so where it matters.

## Data

**Supabase is the only copy of the data.** Each collection lives in its own
`sim_*` table: every screen reads it, every change is written to it, and a
change the database refuses is reported as *not saved*. An empty table is
empty. Nothing is bundled in the code: without Supabase the pages show an
error, and the header's status menu says why — not configured, tables missing,
or unreachable.

Every table is prefixed `sim_`, so sharing the CRM's Supabase project cannot
disturb production data.

Setting up a Supabase project:

1. Copy `.env.example` to `.env` and fill in `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → Data API / API Keys) — what
   the app reads and writes with.
2. Add `DATABASE_URL`: Supabase dashboard → **Connect** → **Session pooler**,
   copy the URI and put your database password in place of `[YOUR-PASSWORD]`.
   Creating tables needs this; the API key above cannot change the schema.
3. `npm run db:setup` — creates the `sim_*` tables (`supabase/schema.sql`,
   row-level security on) in one transaction. It is `if not exists`
   throughout, so it never touches a table or row that is already there.
   (Or paste `supabase/schema.sql` into the Supabase SQL Editor.)
4. Restart the app.

Nothing reachable over HTTP can create, load or reset tables.

## API

| Route | |
|---|---|
| `GET /api/v1/health` | Up, and can it read the database? 503 with the reason if not |
| `GET /api/v1/modules` | The module map |
| `GET /api/v1/dashboard` | Every figure the dashboard renders |
| `GET /api/v1/collections/:name?q=&limit=&offset=` | Any collection, searchable; `format=csv` downloads it |

## Real assets

`public/luxus-green-logo.webp` and `public/vehicles/*.webp` are the same
files `EV-CRM-/apps/web/public` uses — copied in, not recreated. `src/lib/
vehicles.ts` is the model → photo map (mirrors `EV-CRM-`'s
`vehicleCatalog.ts`); every model string generated anywhere in the
simulation (a lead's interest, a deal, a booking, a vehicle unit) is drawn
from that same list, so it always resolves to real product photography —
on the pipeline board, the lead detail page, and DMS's vehicle stock.

## Layout

```
src/
  app/                    routes — one folder per module, mirroring modules.ts
    api/v1/               the HTTP surface
    crm/                  leads (+ [id]), test-drives (+ [id]), support (+ [id]) …
    dms/quotations/       quotations (+ [id]), invoices (+ [id], printable), price-list
    dms/finance-insurance/ loans (+ [id]), insurance, panel & payouts
    dms/orders/           order management (+ [id]), invoices, delivery (+ [id])
    dms/rto/              registrations (+ [id])
    dms/service/          job cards (+ [id]), warranty
    dms/dealers/          Dealer 360 (+ [id]), compliance
    erp/accounting/       sync queue, ledger mapping, reconciliation
    erp/integrations/     connectors, messages, templates, payments, telematics
    admin/, settings/     notifications, users, preferences
  components/
    shell/                AppShell, Sidebar, TopBar, CommandPalette, menus,
                          ModuleScreen, DetailScreen
    ui/                   cards, DataTable, pills, ActionForm, SubmitButton,
                          workflow (Stepper, Timeline, Facts, FilterChips, Tabs)
  lib/                    pure rules shared by screens and actions:
    modules.ts            THE module map
    gst.ts                GST split, HSN/SAC, GSTIN check digit, amount in words
    quotes.ts, finance.ts, insurance.ts, rto.ts, service.ts, sla.ts, fleet.ts
    permissions.ts, notifications.ts, vehicles.ts, time.ts
  server/
    actions/              every write, one file per area (Server Actions)
    workflows/            what crosses modules: invoicing, the accounting
                          ledger, messaging, stock movements, bookings
    notifications.ts      derives the bell from live data
    store.ts              read/insert/update/delete — Supabase only
    numbering.ts          document number series, e-invoice IRN
    types.ts, analytics.ts, staff.ts
docs/                     HOW-THE-SIMULATION-WORKS.md — the guide
scripts/db-setup.ts       npm run db:setup — create the sim_* tables (DATABASE_URL)
supabase/schema.sql       42 sim_* tables
```

`ModuleScreen` is the frame every live module shares: a header pulled off the
module registry, a strip of headline numbers, and a searchable table. Search runs
server-side off `?q=` so `DataTable` can stay a server component — its column
`render` functions cannot be serialised across the client boundary. For the same
reason `DonutChart` takes a format **name** (`"inr"` / `"count"`), not a
formatter function.

## Theme

System, Light or Dark from the account menu or the palette — System
follows the device and is the default; a choice is remembered per browser.
Tokens are defined once on `:root` in `src/app/globals.css`; dark mode overrides
the same names. A single green accent, white cards on an off-white page, and grey
doing most of the typographic work.
