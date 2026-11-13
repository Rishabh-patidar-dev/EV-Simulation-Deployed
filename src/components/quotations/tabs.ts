/** The three screens of Quotation & GST Invoicing. */
export function quotationTabs(counts: { quotes: number; invoices: number; models: number }) {
  return [
    { href: "/dms/quotations", label: "Quotations", count: counts.quotes },
    { href: "/dms/quotations/invoices", label: "Tax invoices", count: counts.invoices },
    { href: "/dms/quotations/price-list", label: "Price list", count: counts.models },
  ];
}
