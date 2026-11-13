import Link from "next/link";
import { notFound } from "next/navigation";
import DetailScreen, { DetailColumns } from "@/components/shell/DetailScreen";
import ActionForm from "@/components/ui/ActionForm";
import { MetricTiles, Panel } from "@/components/ui/cards";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { Facts, Hint, fullDate } from "@/components/ui/workflow";
import { campaignResults } from "@/lib/campaigns";
import { describeSegmentFilter, segmentLeads } from "@/lib/segments";
import { sendCampaign } from "@/server/actions/campaigns";
import { deleteCampaign, updateCampaign, updateCampaignStatus } from "@/server/actions/crm";
import { readMany } from "@/server/store";
import type { Campaign } from "@/server/types";

export const dynamic = "force-dynamic";

const NEXT: Record<Campaign["status"], Array<{ label: string; status: Campaign["status"] }>> = {
  Scheduled: [],
  Running: [
    { label: "Pause", status: "Paused" },
    { label: "Complete", status: "Completed" },
  ],
  Paused: [
    { label: "Resume", status: "Running" },
    { label: "Complete", status: "Completed" },
  ],
  Completed: [],
};

/**
 * One campaign: who it goes to, sending it, how it was delivered, and what
 * its audience did afterwards — measured off the message log, the leads,
 * test drives, deals and bookings, with the cost of each result.
 */
export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await readMany(["campaigns", "segments", "leads", "test_drives", "deals", "bookings", "messages", "enquiries", "landing_pages", "message_templates"] as const);
  const c = data.campaigns.find((x) => x.id === id);
  if (!c) notFound();

  const segment = c.segmentId ? data.segments.find((s) => s.id === c.segmentId) : undefined;
  const members = segment ? segmentLeads(data.leads, segment.filter) : [];
  const page = c.landingPageId ? data.landing_pages.find((p) => p.id === c.landingPageId) : undefined;
  const template = c.template ? data.message_templates.find((t) => t.name === c.template) : undefined;
  const { delivery, results, measured } = campaignResults(c, data);
  const recent = data.messages.filter((m) => m.related?.kind === "campaign" && m.related.id === c.id).slice(0, 8);
  const per = (n: number) => (n ? formatINR(Math.round(c.spend / n)) : "—");
  const canSend = !c.sentAt && c.channel !== "Landing Page" && c.status !== "Completed";

  return (
    <DetailScreen
      moduleHref="/crm/campaigns"
      title={c.name}
      badges={
        <>
          <StatusPill value={c.status} />
          <Pill tone="brand">{c.channel}</Pill>
        </>
      }
      subtitle={<>{c.sentAt ? `Sent ${fullDate(c.sentAt)} to ${c.audience} people` : `Created ${formatDate(c.startedAt)} · not sent`} · budget {formatINR(c.spend)}</>}
      actions={
        <>
          {canSend && (
            <ActionForm action={sendCampaign.bind(null, c.id)}>
              <SubmitButton>Send now</SubmitButton>
            </ActionForm>
          )}
          {c.channel === "Landing Page" && c.status === "Scheduled" && (
            <ActionForm action={updateCampaignStatus.bind(null, c.id)}>
              <input type="hidden" name="status" value="Running" />
              <SubmitButton>Launch</SubmitButton>
            </ActionForm>
          )}
          <span className="flex gap-1.5">
            {NEXT[c.status].map((n) => (
              <ActionForm key={n.status} action={updateCampaignStatus.bind(null, c.id)}>
                <input type="hidden" name="status" value={n.status} />
                <SubmitButton size="sm" tone="ghost">
                  {n.label}
                </SubmitButton>
              </ActionForm>
            ))}
          </span>
          {canSend && <Hint>Goes to every member of the segment the channel can reach, once each.</Hint>}
        </>
      }
    >
      <DetailColumns
        main={
          <>
            <Panel title="Results" description={measured ? (c.landingPageId ? "Everything its landing page produced." : "What the people it reached did after it reached them.") : "Recorded before results were measured — these are the figures typed in."}>
              <MetricTiles
                columns={3}
                items={[
                  { label: c.landingPageId ? "Leads from the page" : "Audience", value: c.landingPageId ? results.leads : (c.audience ?? 0) },
                  { label: "Moved on (qualified+)", value: results.advanced },
                  { label: "Test drives", value: results.testDrives },
                  { label: "Deals", value: results.deals },
                  { label: "Bookings", value: results.bookings },
                  { label: "Booked value", value: formatINR(results.revenue) },
                ]}
              />
              <div className="mt-3">
                <Facts
                  rows={[
                    ["Cost per deal", per(results.deals)],
                    ["Cost per booking", per(results.bookings)],
                    ["Return on spend", c.spend ? `${(results.revenue / c.spend).toFixed(1)}×` : "—"],
                  ]}
                />
              </div>
            </Panel>

            {c.channel !== "Email" && c.channel !== "Landing Page" && (
              <Panel title="Delivery" description="From the message log — receipts move on when delivery reports come in (API Integrations → Messages)." action={{ href: "/erp/integrations/messages", label: "Open the message log" }}>
                <MetricTiles
                  columns={4}
                  items={[
                    { label: "Sent", value: delivery.sent },
                    { label: "Delivered", value: delivery.delivered },
                    { label: "Read", value: delivery.read },
                    { label: "Failed", value: delivery.failed },
                  ]}
                />
                {recent.length > 0 && (
                  <ul className="mt-3 space-y-1 text-[12px]">
                    {recent.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {m.customer} · {m.to}
                        </span>
                        <span className="flex items-center gap-1.5">
                          {m.error && <span style={{ color: "var(--negative)" }}>{m.error}</span>}
                          <StatusPill value={m.status} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}

            {segment && (
              <Panel
                title={`Audience — ${segment.name}`}
                description={`${describeSegmentFilter(segment.filter)} · ${members.length} people today${c.sentAt ? `, ${c.audience} when it was sent` : ""}`}
                action={{ href: "/crm/leads/segments", label: "Open segments" }}
              >
                <ul className="space-y-1 text-[12.5px]">
                  {members.slice(0, 8).map((l) => (
                    <li key={l.id} className="flex justify-between gap-2">
                      <Link href={`/crm/leads/${l.id}`} className="hover:underline">
                        {l.name}
                      </Link>
                      <span style={{ color: "var(--fg-muted)" }}>
                        {l.city} · {l.status} · {l.score}
                      </span>
                    </li>
                  ))}
                  {members.length > 8 && <li style={{ color: "var(--fg-muted)" }}>and {members.length - 8} more</li>}
                  {members.length === 0 && <li style={{ color: "var(--fg-muted)" }}>Nobody matches this segment right now.</li>}
                </ul>
              </Panel>
            )}
          </>
        }
        side={
          <>
            <Panel title="Set-up">
              <Facts
                rows={[
                  ["Channel", c.channel],
                  segment && ["Segment", segment.name],
                  c.template && ["Template", `${c.template}${template ? ` (${template.status.toLowerCase()})` : " (missing)"}`],
                  page && ["Landing page", <Link key="p" href={`/crm/campaigns/landing-pages/${page.id}`} className="underline">/{page.slug}</Link>],
                ]}
              />
              {c.message && (
                <p className="mt-3 rounded-[10px] px-3 py-2 text-[12.5px]" style={{ background: "var(--surface-subtle)" }}>
                  {c.message}
                </p>
              )}
              {template && template.status !== "Approved" && !c.sentAt && (
                <p className="mt-3 text-[12px]" style={{ color: "var(--warning)" }}>
                  The template is {template.status.toLowerCase()} — approve it under API Integrations → Templates before sending, or every message fails.
                </p>
              )}
            </Panel>

            <details className="disclosure surface">
              <summary className="px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                Edit…
              </summary>
              <ActionForm action={updateCampaign.bind(null, c.id)} className="space-y-2 px-4 pb-4">
                <input name="name" defaultValue={c.name} required maxLength={200} className="field" aria-label="Campaign name" />
                <select name="channel" defaultValue={c.channel} className="field" aria-label="Channel" disabled={!!c.sentAt}>
                  {(["Email", "WhatsApp", "Landing Page", "SMS"] satisfies Campaign["channel"][]).map((ch) => (
                    <option key={ch}>{ch}</option>
                  ))}
                </select>
                {c.sentAt && <input type="hidden" name="channel" value={c.channel} />}
                <input name="spend" type="number" min={0} step={1} defaultValue={c.spend} className="field" aria-label="Spend" />
                <SubmitButton size="sm">Save</SubmitButton>
              </ActionForm>
            </details>

            {c.status !== "Running" && !c.reached && (
              <details className="disclosure surface">
                <summary className="px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--negative)" }}>
                  Delete…
                </summary>
                <ActionForm action={deleteCampaign.bind(null, c.id)} className="space-y-2 px-4 pb-4">
                  <p className="text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                    Only a campaign that has reached nobody can be deleted.
                  </p>
                  <SubmitButton size="sm" tone="danger">
                    Yes, delete
                  </SubmitButton>
                </ActionForm>
              </details>
            )}
          </>
        }
      />
    </DetailScreen>
  );
}
