import Link from "next/link";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import SubmitButton from "@/components/ui/SubmitButton";
import { StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { filterRows, readQuery } from "@/lib/search";
import { advanceBookingStatus, cancelBooking } from "@/server/actions/crm";
import { readMany } from "@/server/store";
import { BOOKING_STAGES } from "@/server/types";
import type { Booking } from "@/server/types";

export const dynamic = "force-dynamic";

const NEXT_LABEL: Record<(typeof BOOKING_STAGES)[number], string> = {
  Confirmed: "Finance being arranged",
  "Awaiting Finance": "Ready for delivery",
  "Ready for Delivery": "",
  Delivered: "",
};

const LOAN_OPEN = ["Applied", "Under Review", "Sanctioned"];

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ data }, q] = await Promise.all([readMany(["bookings", "deliveries", "finance_cases"] as const), readQuery(searchParams)]);
  const rows = data.bookings;
  const shown = filterRows(rows, q);
  const deliveryOf = (b: Booking) => data.deliveries.find((d) => d.bookingId === b.id && d.status !== "Cancelled");
  const loanOf = (b: Booking) => data.finance_cases.find((c) => c.bookingId === b.id && LOAN_OPEN.includes(c.status));

  const live = rows.filter((b) => b.status !== "Cancelled" && b.status !== "Delivered");
  const awaitingFinance = rows.filter((b) => b.status === "Awaiting Finance");

  const columns: Column<Booking>[] = [
    { key: "no", header: "Booking", render: (b) => <span className="font-medium">{b.bookingNo}</span> },
    {
      key: "customer",
      header: "Customer",
      render: (b) => (
        <span className="block">
          <span className="block">{b.customer}</span>
          <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
            {b.dealer}
          </span>
        </span>
      ),
    },
    { key: "model", header: "Vehicles", render: (b) => `${b.quantity ?? 1} × ${b.model}`, secondary: true },
    { key: "token", header: "Token", align: "right", render: (b) => formatINR(b.token), secondary: true },
    { key: "total", header: "Order value", align: "right", render: (b) => formatINR(b.total) },
    { key: "status", header: "Status", render: (b) => <StatusPill value={b.status} /> },
    { key: "eta", header: "Delivery ETA", align: "right", secondary: true, render: (b) => formatDate(b.deliveryEta) },
    {
      key: "actions",
      header: "Actions",
      render: (b) => {
        const delivery = deliveryOf(b);
        if (b.status === "Delivered") {
          return delivery ? (
            <Link href={`/dms/orders/delivery/${delivery.id}`} className="text-[11.5px] underline" style={{ color: "var(--brand-ink)" }}>
              Handed over · {delivery.deliveryNo}
            </Link>
          ) : (
            <span className="text-[11.5px]" style={{ color: "var(--brand-ink)" }}>
              Delivered
            </span>
          );
        }
        if (b.status === "Cancelled") return <span style={{ color: "var(--fg-faint)" }}>—</span>;
        const loan = loanOf(b);
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {b.status === "Ready for Delivery" ? (
              <Link href={delivery ? `/dms/orders/delivery/${delivery.id}` : "/dms/orders/delivery"} className="btn btn-primary btn-sm">
                Hand over
              </Link>
            ) : loan ? (
              <Link href={`/dms/finance-insurance/${loan.id}`} className="btn btn-ghost btn-sm">
                Loan {loan.status.toLowerCase()}
              </Link>
            ) : (
              <>
                <ActionForm action={advanceBookingStatus.bind(null, b.id)}>
                  <SubmitButton size="sm">{NEXT_LABEL[b.status as (typeof BOOKING_STAGES)[number]]}</SubmitButton>
                </ActionForm>
                <Link href={`/dms/finance-insurance?new=1&booking=${b.id}`} className="btn btn-ghost btn-sm">
                  Open a loan
                </Link>
              </>
            )}
            <ActionForm action={cancelBooking.bind(null, b.id)}>
              <SubmitButton size="sm" tone="danger">Cancel</SubmitButton>
            </ActionForm>
          </div>
        );
      },
    },
  ];

  return (
    <ModuleScreen
      href="/crm/bookings"
      exportCollection="bookings"
      searchPlaceholder="Search bookings"
      stats={[
        { label: "Bookings", value: String(rows.length), hint: `${shown.length} shown` },
        { label: "In flight", value: String(live.length), hint: "Confirmed but not yet delivered" },
        { label: "Awaiting finance", value: String(awaitingFinance.length), hint: "Blocked on loan sanction" },
        { label: "Token collected", value: formatINR(rows.filter((b) => b.status !== "Cancelled").reduce((s, b) => s + b.token, 0)), hint: "Across live bookings" },
      ]}
    >
      <DataTable rows={shown} columns={columns} empty="No bookings match that search." />
    </ModuleScreen>
  );
}
