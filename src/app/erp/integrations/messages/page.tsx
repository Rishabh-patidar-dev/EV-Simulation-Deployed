import Link from "next/link";
import { integrationTabs } from "@/components/erp/tabs";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, relativeTime } from "@/components/ui/primitives";
import { FilterChips, Tabs, withParams } from "@/components/ui/workflow";
import { maskPhone, recordHref } from "@/lib/links";
import { filterRows } from "@/lib/search";
import { refreshDeliveryReports, retryMessage } from "@/server/actions/integrations";
import { readMany } from "@/server/store";
import type { Message } from "@/server/types";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATUSES = ["Sent", "Delivered", "Read", "Failed"] as const;

const COLUMNS: Column<Message>[] = [
  {
    key: "to",
    header: "To",
    render: (m) => (
      <span className="block">
        <span className="block font-medium">{m.customer}</span>
        <span className="num block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {maskPhone(m.to)}
        </span>
      </span>
    ),
  },
  { key: "channel", header: "Channel", render: (m) => <Pill tone={m.channel === "WhatsApp" ? "positive" : "neutral"}>{m.channel}</Pill> },
  {
    key: "body",
    header: "Message",
    render: (m) => (
      <span className="block max-w-[26rem]">
        <span className="block text-[11px]" style={{ color: "var(--fg-faint)" }}>
          {m.template}
        </span>
        <span className="block text-[12.5px]">{m.body}</span>
        {m.error && (
          <span className="block text-[11.5px]" style={{ color: "var(--negative)" }}>
            {m.error}
          </span>
        )}
      </span>
    ),
  },
  {
    key: "related",
    header: "About",
    secondary: true,
    render: (m) => {
      const href = recordHref(m.related);
      return href && m.related ? (
        <Link href={href} className="text-[12px] underline">
          {m.related.label}
        </Link>
      ) : (
        "—"
      );
    },
  },
  { key: "status", header: "Status", render: (m) => <StatusPill value={m.status} /> },
  { key: "at", header: "Sent", align: "right", render: (m) => <span className="whitespace-nowrap">{relativeTime(m.at)}</span> },
  {
    key: "retry",
    header: "",
    render: (m) =>
      m.status === "Failed" ? (
        <ActionForm action={retryMessage.bind(null, m.id)}>
          <SubmitButton size="sm" tone="ghost">
            Retry
          </SubmitButton>
        </ActionForm>
      ) : null,
  },
];

/** Every outbound customer message, with the status the provider reported — and the reason when one failed. */
export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const statusParam = one(raw.status);
  const status = (STATUSES as readonly string[]).includes(statusParam) ? (statusParam as Message["status"]) : undefined;

  const { data } = await readMany(["messages", "connectors", "message_templates", "payments", "telematics"] as const);
  const rows = [...data.messages].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  const shown = filterRows(rows, q).filter((m) => !status || m.status === status);
  const whatsapp = rows.filter((m) => m.channel === "WhatsApp");
  const delivered = rows.filter((m) => m.status === "Delivered" || m.status === "Read");

  return (
    <ModuleScreen
      href="/erp/integrations"
      exportCollection="messages"
      searchPlaceholder="Search messages, customers or templates"
      tabs={
        <Tabs
          current="/erp/integrations/messages"
          tabs={integrationTabs({ connectors: data.connectors.length, messages: rows.length, templates: data.message_templates.length, payments: data.payments.length, devices: data.telematics.length })}
        />
      }
      actions={
        <ActionForm action={refreshDeliveryReports}>
          <SubmitButton tone="ghost">Pull delivery reports</SubmitButton>
        </ActionForm>
      }
      stats={[
        { label: "Messages", value: String(rows.length), hint: `${whatsapp.length} on WhatsApp` },
        { label: "Delivered", value: rows.length ? `${Math.round((delivered.length / rows.length) * 100)}%` : "—", hint: `${rows.filter((m) => m.status === "Read").length} read` },
        { label: "Failed", value: String(rows.filter((m) => m.status === "Failed").length), hint: "Retry once the channel is back", tone: rows.some((m) => m.status === "Failed") ? "negative" : "neutral" },
        { label: "Awaiting report", value: String(rows.filter((m) => m.status === "Sent").length), hint: "Sent, no delivery report yet" },
      ]}
    >
      <FilterChips
        total={rows.length}
        current={status}
        hrefFor={(value) => withParams("/erp/integrations/messages", { q, status: value })}
        options={STATUSES.map((s) => ({ value: s, count: rows.filter((m) => m.status === s).length }))}
      />
      <DataTable rows={shown} columns={COLUMNS} empty={q || status ? "No message matches those filters." : "No messages yet — they go out as quotations, bookings, deliveries and tickets move."} />
    </ModuleScreen>
  );
}
