/**
 * The catalogue of outside systems this platform talks to.
 *
 * `src/lib/modules.ts` is the source of truth for the module map; this is the
 * same idea for integrations. The API Integrations screen renders a card for
 * every key here, whether or not a `connectors` row exists yet, so a connector
 * the platform knows about can never be invisible just because nobody has set
 * it up.
 *
 * `about` is what the third-party system itself is — written for someone
 * seeing the name for the first time, and limited to what matters for the
 * integration. Where the provider is a named, unambiguous system (Meta's
 * WhatsApp Cloud API, NIC's IRP, Vahan) it is described by name. Where the
 * provider is a choice the deployment makes (the payment gateway, the
 * telematics vendor), the contract is described instead of a brand.
 */

import type { Connector } from "@/server/types";

export interface ConnectorProfile {
  key: Connector["key"];
  name: string;
  /** Default provider for a connector that has no row yet. */
  provider: string;
  category: Connector["category"];
  /** What stops working in this platform when the connector is off. */
  depends: string;
  /** What the outside system is. Shown under "About" on the connector card. */
  about: string[];
  /** Non-secret settings a new row starts with. */
  config: Record<string, string>;
}

export const CONNECTOR_CATALOGUE: ConnectorProfile[] = [
  {
    key: "whatsapp",
    name: "WhatsApp Business",
    provider: "Meta WhatsApp Cloud API",
    category: "Messaging",
    depends: "Quotations, booking confirmations, delivery OTPs, service reminders, ticket updates",
    about: [
      "Meta's own hosted WhatsApp Business API — no server of ours sits between the platform and WhatsApp.",
      "Business-initiated messages must use a template Meta has approved in advance. Quotation, OTP and service-reminder templates are managed under Message Templates.",
      "A customer's reply opens a 24-hour window in which free-form messages can be sent. Outside it, only an approved template will deliver.",
      "Meta calls back with delivery status for every message — sent, delivered, read or failed — which is what the Messages log records.",
      "Each number is tied to a WhatsApp Business Account and a verified business; the display name needs Meta's approval before it appears to customers.",
    ],
    config: { businessNumber: "", wabaId: "" },
  },
  {
    key: "sms",
    name: "Transactional SMS",
    provider: "DLT-registered route",
    category: "Messaging",
    depends: "Fallback notifications on DLT-registered templates",
    about: [
      "TRAI requires every commercial SMS in India to go through DLT (Distributed Ledger Technology) registration — the sender, the header and the message template are all registered before anything can be sent.",
      "The header, or sender ID, is six characters (for example LXSGRN) and is what the customer sees in place of a number.",
      "Each template is registered against an entity ID and approved separately; variable parts are fixed in position, so the text cannot be changed freely at send time.",
      "Operators scrub every message against the registered template. An unregistered or altered message is rejected by the network, not by us.",
      "Used here as the fallback when WhatsApp cannot deliver.",
    ],
    config: { senderId: "", entityId: "" },
  },
  {
    key: "payments",
    name: "Payment gateway",
    provider: "Payment gateway",
    category: "Payments",
    depends: "Booking-token links and dealer invoice collections",
    about: [
      "Collects the 10% booking token from retail customers and payments against dealer invoices, through UPI, cards, net banking and wallets.",
      "The platform creates a payment link and sends it to the customer; it never handles or stores card details, which is what keeps it outside PCI-DSS scope.",
      "The gateway calls back when a payment is captured. That callback — not a person — is what marks the booking paid and the invoice settled.",
      "Captured money reaches the dealership's bank account on the gateway's settlement cycle, typically a working day or two after capture, net of its fee.",
      "The gateway is a deployment choice. Credentials live in the secret store; only the merchant name and settlement account appear here.",
    ],
    config: { merchant: "", settlement: "" },
  },
  {
    key: "telematics",
    name: "Telematics",
    provider: "Telematics unit",
    category: "Telematics",
    depends: "Battery health, location and usage from delivered vehicles",
    about: [
      "A unit fitted to each vehicle at handover that reports over a mobile network: odometer, location, battery state of charge and state of health, and charging sessions.",
      "The readings are what the warranty rules engine uses when a dealer does not supply figures — distance since handover and battery health below 70% are both decided on this data.",
      "Polling interval is a setting, not a live stream; a vehicle that has not reported within it shows as offline.",
      "Activation happens automatically at the OTP handover, so a vehicle starts reporting from the day it is delivered.",
      "The device vendor is a deployment choice; the platform only needs the feed.",
    ],
    config: { provider: "", pollMinutes: "15" },
  },
  {
    key: "accounting",
    name: "Tally Prime",
    provider: "Tally Prime",
    category: "Accounting",
    depends: "Every sales, receipt and payout voucher",
    about: [
      "Tally Prime is the accounting system most Indian dealerships already run their books on; this platform posts to it rather than replacing it.",
      "Every dealer invoice, retail tax invoice, receipt, credit note and payout queues a voucher. Nothing posts until the connector is up and every ledger it touches is mapped.",
      "Ledger mapping is held under ERP / Accounting Integration — an unmapped ledger makes the voucher fail with that reason instead of posting to the wrong account.",
      "A failed voucher waits in the queue and is replayed when the connection returns; vouchers are never silently dropped.",
      "Reconciliation compares each dealer's outstanding balance here against the balance in the books, so the two can be proved equal.",
    ],
    config: { company: "", voucherSeries: "" },
  },
  {
    key: "vahan",
    name: "Vahan",
    provider: "Parivahan — Vahan 4.0 dealer point",
    category: "Government",
    depends: "Filing registrations from RTO & Registration",
    about: [
      "Vahan is the Ministry of Road Transport and Highways' national vehicle registration system, reached through the Parivahan portal.",
      "Dealers registered as a dealer point file the registration themselves: Forms 20, 21 and 22 with insurance, invoice and address proof attached.",
      "The RTO raises objections on the portal; they are answered there, and only then is the permanent registration number issued.",
      "Battery-operated vehicles are exempt from the registration fee and from permit requirements, and carry green number plates.",
      "The registration number Vahan returns is written back onto the vehicle record, which is what closes the temporary registration before its one month lapses.",
    ],
    config: { dealerPointId: "" },
  },
  {
    key: "gst_irp",
    name: "GST e-invoice (IRP)",
    provider: "NIC Invoice Registration Portal",
    category: "Government",
    depends: "e-Invoice IRNs on B2B tax invoices",
    about: [
      "The Invoice Registration Portal run by NIC registers business-to-business tax invoices under GST and returns an Invoice Reference Number and a signed QR code.",
      "It applies to B2B invoices only. A retail sale to a customer without a GSTIN needs no IRN, and the platform does not request one.",
      "An invoice without its IRN is not a valid tax invoice for the buyer's input credit, so a B2B invoice waits for the IRN rather than being issued incomplete.",
      "The IRN is a 64-character hash over the seller's GSTIN, the financial year and the invoice number — which is why invoice numbers can never repeat within a year.",
      "Registered invoice data flows on to the GST return and the e-way bill system, so the same invoice is not keyed in twice.",
    ],
    config: { gstin: "" },
  },
  {
    key: "eway_bill",
    name: "E-way bill",
    provider: "NIC E-Way Bill portal",
    category: "Government",
    depends: "E-way bills when vehicles are dispatched for delivery",
    about: [
      "The national e-way bill system, also run by NIC, covers the movement of goods — here, vehicles leaving the dealership or the plant.",
      "It is required before dispatch above the consignment value threshold, which a vehicle is comfortably over. Moving without one exposes the consignment to detention and penalty.",
      "The bill carries the invoice, the transporter and the vehicle number, and is valid for a limited period based on the distance to be covered.",
      "Where the invoice already has an IRN, the e-way bill can be generated from it rather than re-entered.",
      "This is why dispatch in Vehicle Delivery is refused while the connector is down: the paperwork that must travel with the vehicle cannot be raised.",
    ],
    config: { gstin: "", userId: "" },
  },
  {
    key: "ticketing",
    name: "Customer ticketing",
    provider: "Raiseaticket",
    category: "Support",
    depends: "Support tickets raised from the web form, and their status back to the customer",
    about: [
      "Raiseaticket (raiseaticket.com) is a cloud-hosted helpdesk — nothing to install, reached in a browser by agents and customers.",
      "It is offered as a free helpdesk product, which is what makes it workable across a dealer network where every service advisor needs a login.",
      "Customers raise tickets through a self-service portal or by email; an incoming email becomes a ticket, and replies thread onto it instead of starting a new one.",
      "Tickets carry a priority and an SLA, are assigned to a department or an agent, and escalate when the clock runs out — which is the behaviour Customer Support & Ticketing mirrors here.",
      "Its dashboards report volume, first-response and resolution times, and agent workload.",
      "Verify the current feature set and terms with Raiseaticket before quoting them to a customer.",
    ],
    config: { portal: "", department: "" },
  },
];

export const CONNECTOR_PROFILE: Record<Connector["key"], ConnectorProfile> = Object.fromEntries(
  CONNECTOR_CATALOGUE.map((profile) => [profile.key, profile]),
) as Record<Connector["key"], ConnectorProfile>;
