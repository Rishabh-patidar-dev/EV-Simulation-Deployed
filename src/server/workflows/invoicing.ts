import "server-only";
import { computeTax, derivedGstin } from "@/lib/gst";
import { runtimeId } from "../ids";
import { invoiceReferenceNumber, nextNumber, numericRef } from "../numbering";
import { insertRow, readCollection } from "../store";
import type { LedgerKey, QuoteLine, TaxInvoice } from "../types";
import { queueVoucher } from "./ledger";

/**
 * Issues a dealer → customer GST tax invoice and queues it for the books.
 *
 * Totals are computed once, here, and stored on the invoice, so a later change
 * to a price or a rate never alters an invoice already issued. A buyer with a
 * GSTIN gets an e-invoice: the IRN is the IRP's hash of the seller GSTIN,
 * financial year and invoice number, with an acknowledgement number and time.
 */
export async function issueTaxInvoice(input: {
  kind: TaxInvoice["kind"];
  dealer: string;
  customer: string;
  customerGstin: string | null;
  placeOfSupply: string;
  lines: QuoteLine[];
  discount: number;
  subsidy: number;
  quotationId?: string | null;
  bookingId?: string | null;
  jobCardId?: string | null;
  vins?: string[];
  ewayBillNo?: string | null;
}): Promise<TaxInvoice> {
  const [{ rows: dealers }, { rows: invoices }, { rows: connectors }] = await Promise.all([readCollection("dealers"), readCollection("tax_invoices"), readCollection("connectors")]);
  const dealer = dealers.find((d) => d.name === input.dealer);
  const dealerState = dealer?.state ?? input.placeOfSupply;
  const dealerGstin = dealer?.gstin ?? derivedGstin(input.dealer, dealerState);

  const tax = computeTax(input.lines, input.discount, dealerState, input.placeOfSupply);
  const now = new Date();
  const invoiceNo = nextNumber(
    invoices.map((i) => i.invoiceNo),
    "TI",
    5000
  );
  // A B2B invoice takes its IRN from the IRP; with the portal down it is issued now and the IRN generated once it is back.
  const withIrn = Boolean(input.customerGstin) && connectors.find((c) => c.key === "gst_irp")?.status === "Connected";

  const invoice: TaxInvoice = {
    id: runtimeId("TXI"),
    invoiceNo,
    kind: input.kind,
    dealer: input.dealer,
    dealerGstin,
    dealerState,
    customer: input.customer,
    customerGstin: input.customerGstin,
    placeOfSupply: input.placeOfSupply,
    quotationId: input.quotationId ?? null,
    bookingId: input.bookingId ?? null,
    jobCardId: input.jobCardId ?? null,
    lines: input.lines,
    discount: tax.discount,
    subsidy: input.subsidy,
    taxable: tax.taxable,
    cgst: tax.cgst,
    sgst: tax.sgst,
    igst: tax.igst,
    total: tax.total,
    payable: Math.max(0, tax.total - input.subsidy),
    irn: withIrn ? invoiceReferenceNumber(dealerGstin, invoiceNo, now) : null,
    ackNo: withIrn ? numericRef(15) : null,
    ackAt: withIrn ? now.toISOString() : null,
    ewayBillNo: input.ewayBillNo ?? null,
    vins: input.vins ?? [],
    issuedAt: now.toISOString(),
    status: "Issued",
    cancelReason: null,
  };
  await insertRow("tax_invoices", invoice);

  const ledgers = new Set<LedgerKey>(["debtors_retail", ...(tax.interState ? (["output_igst"] as const) : (["output_cgst", "output_sgst"] as const))]);
  for (const line of input.lines) {
    if (line.gstRate === 0) continue;
    ledgers.add(line.kind === "Vehicle" ? "sales_vehicle" : line.hsn === "998714" ? "sales_service" : "sales_parts");
  }
  await queueVoucher({
    voucherType: "Sales",
    source: "Retail Invoice",
    sourceId: invoice.id,
    reference: invoiceNo,
    party: input.customer,
    amount: invoice.total,
    ledgers: [...ledgers],
  });
  return invoice;
}
