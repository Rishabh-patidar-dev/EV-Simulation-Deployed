/** The screens of Finance & Insurance. */
export function financeTabs(counts: { loans: number; policies: number; financiers: number }) {
  return [
    { href: "/dms/finance-insurance", label: "Loans", count: counts.loans },
    { href: "/dms/finance-insurance/insurance", label: "Insurance", count: counts.policies },
    { href: "/dms/finance-insurance/panel", label: "Financier panel & payouts", count: counts.financiers },
  ];
}
