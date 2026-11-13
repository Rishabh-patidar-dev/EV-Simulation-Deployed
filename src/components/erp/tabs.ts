/** The screens of ERP / Accounting Integration. */
export function accountingTabs(counts: { queue: number; ledgers: number; dealers: number }) {
  return [
    { href: "/erp/accounting", label: "Sync queue", count: counts.queue },
    { href: "/erp/accounting/ledgers", label: "Ledger mapping", count: counts.ledgers },
    { href: "/erp/accounting/reconciliation", label: "Dealer reconciliation", count: counts.dealers },
  ];
}

/** The screens of API Integrations. */
export function integrationTabs(counts: { connectors: number; messages: number; templates: number; payments: number; devices: number }) {
  return [
    { href: "/erp/integrations", label: "Connectors", count: counts.connectors },
    { href: "/erp/integrations/messages", label: "Messages", count: counts.messages },
    { href: "/erp/integrations/templates", label: "Templates", count: counts.templates },
    { href: "/erp/integrations/payments", label: "Payments", count: counts.payments },
    { href: "/erp/integrations/telematics", label: "Telematics", count: counts.devices },
  ];
}
