/** Spare Parts Inventory's two screens: the catalogue, and dealers' orders against it. */
export function partTabs(counts: { parts: number; orders: number }) {
  return [
    { href: "/dms/inventory/spare-parts", label: "Catalogue & stock", count: counts.parts },
    { href: "/dms/inventory/spare-parts/orders", label: "Dealer orders", count: counts.orders },
  ];
}
