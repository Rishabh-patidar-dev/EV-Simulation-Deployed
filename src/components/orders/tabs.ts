/** Order Management's two screens: every order, and the short list stock could not cover. */
export function orderTabs(counts: { orders: number; short: number }) {
  return [
    { href: "/dms/orders", label: "All orders", count: counts.orders },
    { href: "/dms/orders/short", label: "Short of stock", count: counts.short },
  ];
}
