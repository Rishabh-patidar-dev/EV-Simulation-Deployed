/** Where a record lives in the app, from the `{ kind, id, label }` other records point at it with. */
export function recordHref(related: { kind: string; id: string; label: string } | null | undefined): string | null {
  if (!related) return null;
  const q = encodeURIComponent(related.label);
  switch (related.kind) {
    case "quotation":
      return `/dms/quotations/${related.id}`;
    case "booking":
      return `/crm/bookings?q=${q}`;
    case "delivery":
      return `/dms/orders/delivery/${related.id}`;
    case "finance_case":
      return `/dms/finance-insurance/${related.id}`;
    case "registration":
      return `/dms/rto/${related.id}`;
    case "ticket":
      return `/crm/support/${related.id}`;
    case "job_card":
      return `/dms/service/jobcards/${related.id}`;
    case "test_drive":
      return `/crm/test-drives/${related.id}`;
    case "invoice":
      return `/dms/orders/invoices?q=${q}`;
    case "vehicle":
      return `/erp/integrations/telematics?q=${q}`;
    default:
      return null;
  }
}

/** "+91 98••• ••210" — enough to recognise a number without printing it whole. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return phone;
  return `+91 ${digits.slice(0, 2)}••• ••${digits.slice(7)}`;
}
