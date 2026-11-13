import Link from "next/link";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import FlashToast from "@/components/ui/FlashToast";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import DonutChart from "@/components/charts/DonutChart";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { Card, CardHeader, Pill, StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { Hint } from "@/components/ui/workflow";
import { campaignResults } from "@/lib/campaigns";
import { filterRows, readQuery } from "@/lib/search";
import { segmentLeads } from "@/lib/segments";
import { createCampaign } from "@/server/actions/campaigns";
import { readMany } from "@/server/store";
import type { Campaign } from "@/server/types";

export const dynamic = "force-dynamic";

type Row = Campaign & { r: ReturnType<typeof campaignResults> };

const COLUMNS: Column<Row>[] = [
  {
    key: "name",
    header: "Campaign",
    render: (c) => (
      <Link href={`/crm/campaigns/${c.id}`} className="block hover:underline">
        <span className="block font-medium" style={{ color: "var(--brand-ink)" }}>
          {c.name}
        </span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {c.sentAt ? `sent ${formatDate(c.sentAt)}` : `created ${formatDate(c.startedAt)}`}
        </span>
      </Link>
    ),
  },
  { key: "channel", header: "Channel", render: (c) => <Pill tone="brand">{c.channel}</Pill> },
  { key: "status", header: "Status", render: (c) => <StatusPill value={c.status} /> },
  { key: "reached", header: "Reached", align: "right", secondary: true, render: (c) => (c.r.delivery.sent || c.reached).toLocaleString("en-IN") },
  {
    key: "results",
    header: "Results",
    align: "right",
    render: (c) =>
      c.r.measured ? (
        <span className="block whitespace-nowrap text-[12.5px]">
          {c.r.results.deals} deals · {c.r.results.bookings} bookings
        </span>
      ) : (
        <span className="text-[12px]" style={{ color: "var(--fg-faint)" }} title="Recorded before results were measured">
          {c.leads} leads (typed)
        </span>
      ),
  },
  { key: "spend", header: "Spend", align: "right", render: (c) => formatINR(c.spend) },
  {
    key: "roi",
    header: "Revenue",
    align: "right",
    secondary: true,
    render: (c) => (c.r.results.revenue ? <span style={{ color: "var(--positive)" }}>{formatINR(c.r.results.revenue)}</span> : <span style={{ color: "var(--fg-faint)" }}>—</span>),
  },
];

/**
 * Campaign Master — EV-CRM's campaign management: each campaign targets a
 * saved segment (or drives a landing page), goes out through the messaging
 * connectors, and is judged on what its audience did afterwards — never on
 * figures typed in. Each campaign opens on its own page to send and measure.
 */
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ q?: string; new?: string; deleted?: string }> }) {
  const [{ data }, q, params] = await Promise.all([
    readMany(["campaigns", "segments", "message_templates", "landing_pages", "leads", "test_drives", "deals", "bookings", "messages", "enquiries"] as const),
    readQuery(searchParams),
    searchParams,
  ]);
  const rows: Row[] = data.campaigns.map((c) => ({ ...c, r: campaignResults(c, data) }));
  const shown = filterRows(rows, q);

  const spend = rows.reduce((s, c) => s + c.spend, 0);
  const revenue = rows.reduce((s, c) => s + c.r.results.revenue, 0);
  const bookings = rows.reduce((s, c) => s + c.r.results.bookings, 0);
  const byChannel = (["WhatsApp", "SMS", "Email", "Landing Page"] as const)
    .map((channel) => ({ label: channel, value: rows.filter((c) => c.channel === channel).reduce((s, c) => s + c.r.results.deals, 0) }))
    .filter((d) => d.value > 0);
  const templates = data.message_templates.filter((t) => t.channel === "WhatsApp" || t.channel === "SMS");

  return (
    <ModuleScreen
      href="/crm/campaigns"
      exportCollection="campaigns"
      searchPlaceholder="Search campaigns"
      stats={[
        { label: "Campaigns", value: String(rows.length), hint: `${rows.filter((c) => c.status === "Running").length} running · ${rows.filter((c) => !c.sentAt && c.status === "Scheduled").length} not sent` },
        { label: "Spend", value: formatINR(spend), hint: "Across every channel" },
        { label: "Bookings won", value: String(bookings), hint: "By people a campaign reached, after it reached them" },
        { label: "Return on spend", value: spend ? `${(revenue / spend).toFixed(1)}×` : "—", hint: `${formatINR(revenue)} booked` },
      ]}
      toolbar={
        <Disclosure label="New campaign" open={params.new === "1"}>
          <ActionForm action={createCampaign} resetOnSuccess className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="field-label" htmlFor="cm-name">
                  Name
                </label>
                <input id="cm-name" name="name" required minLength={3} maxLength={120} className="field" />
              </div>
              <div>
                <label className="field-label" htmlFor="cm-channel">
                  Channel
                </label>
                <select id="cm-channel" name="channel" className="field" defaultValue="WhatsApp">
                  {["WhatsApp", "SMS", "Email", "Landing Page"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="cm-segment">
                  Segment (WhatsApp, SMS, Email)
                </label>
                <select id="cm-segment" name="segmentId" className="field" defaultValue="">
                  <option value="">—</option>
                  {data.segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {segmentLeads(data.leads, s.filter).length} people
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="cm-template">
                  Template (WhatsApp, SMS)
                </label>
                <select id="cm-template" name="template" className="field" defaultValue="">
                  <option value="">—</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.channel} · {t.name} ({t.status.toLowerCase()})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="cm-page">
                  Landing page (Landing Page)
                </label>
                <select id="cm-page" name="landingPageId" className="field" defaultValue="">
                  <option value="">—</option>
                  {data.landing_pages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · /{p.slug}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="cm-spend">
                  Budget (₹)
                </label>
                <input id="cm-spend" name="spend" type="number" min={0} step={1} defaultValue={50000} className="field" />
              </div>
              <div className="sm:col-span-2">
                <label className="field-label" htmlFor="cm-message">
                  Email body (Email)
                </label>
                <input id="cm-message" name="message" maxLength={1000} className="field" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton>Create (Scheduled)</SubmitButton>
              <Hint>WhatsApp and SMS go out on an approved template; a pending one makes every message fail, as Meta and DLT would. A landing-page campaign is measured on its page&apos;s submissions.</Hint>
            </div>
          </ActionForm>
        </Disclosure>
      }
      aside={
        <Card>
          <CardHeader title="Deals by channel" subtitle="Which channel actually produces business" />
          <div className="px-5 pb-6 pt-1">
            {byChannel.length ? (
              <DonutChart data={byChannel} centerLabel="Deals" />
            ) : (
              <p className="py-3 text-center text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                No measured results yet.
              </p>
            )}
          </div>
        </Card>
      }
    >
      {params.deleted && <FlashToast param="deleted" message={`Campaign deleted — ${params.deleted.slice(0, 80)}`} />}
      <DataTable rows={shown} columns={COLUMNS} empty="No campaigns match that search." />
    </ModuleScreen>
  );
}
