import Link from "next/link";
import { notFound } from "next/navigation";
import DetailScreen, { DetailColumns } from "@/components/shell/DetailScreen";
import ActionForm from "@/components/ui/ActionForm";
import { MetricTiles, Panel } from "@/components/ui/cards";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { Facts, Hint } from "@/components/ui/workflow";
import { pageFunnel, webhookSample } from "@/lib/campaigns";
import { INDIAN_STATES } from "@/lib/gst";
import { INVESTMENT_BANDS } from "@/lib/onboarding";
import { VEHICLE_MODELS } from "@/lib/vehicles";
import { addPageViews, captureSubmission } from "@/server/actions/campaigns";
import { deleteLandingPage, updateLandingPage, updateLandingPageStatus } from "@/server/actions/crm";
import { readMany } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * One landing page — EV-CRM's landing-page campaign: the unique id the
 * external page posts back, its funnel from visit to booking, every enquiry
 * and dealer application it produced, and a capture form standing in for the
 * live page's webhook (routed by intent, attributed to this page).
 */
export default async function LandingPageDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await readMany(["landing_pages", "enquiries", "applications", "leads", "test_drives", "deals", "bookings", "campaigns"] as const);
  const page = data.landing_pages.find((p) => p.id === id);
  if (!page) notFound();

  const f = pageFunnel(page, data);
  const enquiries = data.enquiries.filter((e) => e.landingPageId === page.id).slice(0, 10);
  const applications = data.applications.filter((a) => a.landingPageId === page.id).slice(0, 10);
  const campaign = page.campaignId ? data.campaigns.find((c) => c.id === page.campaignId) : undefined;
  const live = page.status === "Live";
  const both = page.intent === "Both";
  const dealership = page.intent === "Dealership";

  return (
    <DetailScreen
      moduleHref="/crm/campaigns/landing-pages"
      title={page.name}
      badges={
        <>
          <StatusPill value={page.status} />
          {page.intent && <Pill tone="brand">{page.intent}</Pill>}
        </>
      }
      subtitle={
        <>
          /{page.slug} · updated {formatDate(page.updatedAt)}
          {campaign && (
            <>
              {" "}
              · campaign{" "}
              <Link href={`/crm/campaigns/${campaign.id}`} className="underline">
                {campaign.name}
              </Link>
            </>
          )}
        </>
      }
      actions={
        page.status === "Draft" ? (
          <ActionForm action={updateLandingPageStatus.bind(null, page.id)}>
            <input type="hidden" name="status" value="Live" />
            <SubmitButton>Publish</SubmitButton>
          </ActionForm>
        ) : live ? (
          <ActionForm action={updateLandingPageStatus.bind(null, page.id)}>
            <input type="hidden" name="status" value="Archived" />
            <SubmitButton tone="ghost">Archive</SubmitButton>
          </ActionForm>
        ) : undefined
      }
    >
      <DetailColumns
        main={
          <>
            <Panel title="Funnel" description="From a visit to a booking — every figure counted from the records this page produced.">
              <MetricTiles
                columns={4}
                items={[
                  { label: "Visits", value: page.views.toLocaleString("en-IN") },
                  { label: "Submissions", value: `${f.submissions}${f.conversion !== null ? ` · ${f.conversion}%` : ""}` },
                  { label: "Enquiries", value: f.enquiries },
                  { label: "Dealer applications", value: f.applications },
                  { label: "Leads", value: f.leads },
                  { label: "Test drives", value: f.testDrives },
                  { label: "Deals", value: f.deals },
                  { label: "Bookings", value: `${f.bookings} · ${formatINR(f.revenue)}` },
                ]}
              />
              {page.submissions > f.submissions && (
                <Hint>{page.submissions - f.submissions} submissions were recorded before attribution and are counted in the total only.</Hint>
              )}
            </Panel>

            {live ? (
              <Panel title="Capture a submission" description="Stands in for the live page's webhook — routed by intent and attributed to this page, as EV-CRM's ingest does.">
                <ActionForm action={captureSubmission.bind(null, page.id)} resetOnSuccess className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {both && (
                      <div>
                        <label className="field-label" htmlFor="cs-intent">
                          Visitor wants
                        </label>
                        <select id="cs-intent" name="intent" className="field" defaultValue="Retail">
                          <option value="Retail">To buy a vehicle</option>
                          <option value="Dealership">A dealership</option>
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="field-label" htmlFor="cs-name">
                        Name
                      </label>
                      <input id="cs-name" name="name" required className="field" />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="cs-phone">
                        Phone
                      </label>
                      <input id="cs-phone" name="phone" type="tel" required className="field" />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="cs-email">
                        Email
                      </label>
                      <input id="cs-email" name="email" type="email" className="field" />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="cs-city">
                        City
                      </label>
                      <input id="cs-city" name="city" required className="field" />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="cs-state">
                        State
                      </label>
                      <select id="cs-state" name="state" className="field" defaultValue="">
                        <option value="">Not given</option>
                        {INDIAN_STATES.map((st) => (
                          <option key={st}>{st}</option>
                        ))}
                      </select>
                    </div>
                    {!dealership && (
                      <div>
                        <label className="field-label" htmlFor="cs-model">
                          Model (retail)
                        </label>
                        <select id="cs-model" name="model" className="field" defaultValue={VEHICLE_MODELS[0]}>
                          {VEHICLE_MODELS.map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {(dealership || both) && (
                      <>
                        <div>
                          <label className="field-label" htmlFor="cs-firm">
                            Firm (dealership)
                          </label>
                          <input id="cs-firm" name="firm" className="field" />
                        </div>
                        <div>
                          <label className="field-label" htmlFor="cs-invest">
                            Investment (dealership)
                          </label>
                          <select id="cs-invest" name="investment" className="field" defaultValue="">
                            <option value="">Not given</option>
                            {INVESTMENT_BANDS.map((b) => (
                              <option key={b}>{b}</option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                    <div>
                      <label className="field-label" htmlFor="cs-utm">
                        utm_source
                      </label>
                      <input id="cs-utm" name="utmSource" maxLength={40} className="field" placeholder="google, facebook, …" />
                    </div>
                  </div>
                  <SubmitButton>Capture</SubmitButton>
                </ActionForm>
              </Panel>
            ) : (
              <Panel title="Capture">
                <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                  {page.status === "Draft" ? "Publish the page to take submissions." : "Archived — it no longer takes submissions."}
                </p>
              </Panel>
            )}

            <Panel title="What it produced" description="Newest first, ten of each.">
              {enquiries.length === 0 && applications.length === 0 ? (
                <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                  Nothing attributed to this page yet.
                </p>
              ) : (
                <ul className="space-y-1.5 text-[12.5px]">
                  {enquiries.map((e) => (
                    <li key={e.id} className="flex flex-wrap justify-between gap-2">
                      <span>
                        Enquiry {e.reference} · {e.customer} · {e.model}
                        {e.utmSource ? ` · ${e.utmSource}` : ""}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {e.leadId ? (
                          <Link href={`/crm/leads/${e.leadId}`} className="underline">
                            lead
                          </Link>
                        ) : (
                          <Link href={`/crm/enquiries?q=${encodeURIComponent(e.reference)}`} className="underline">
                            convert
                          </Link>
                        )}
                        <StatusPill value={e.status} />
                      </span>
                    </li>
                  ))}
                  {applications.map((a) => (
                    <li key={a.id} className="flex flex-wrap justify-between gap-2">
                      <Link href={`/dms/onboarding/${a.id}`} className="hover:underline">
                        Application {a.applicationNo} · {a.firm}, {a.city}
                      </Link>
                      <StatusPill value={a.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        }
        side={
          <>
            <Panel title="Integration" description="The external page posts each submission with this id, so it lands here.">
              <Facts
                rows={[
                  ["Unique id", <span key="u" className="font-mono">{page.uniqueId ?? "— (created before ids)"}</span>],
                  page.gtmContainerId && ["GTM", page.gtmContainerId],
                ]}
              />
              <pre className="mt-3 overflow-x-auto rounded-[10px] p-2.5 text-[11px] leading-relaxed" style={{ background: "var(--surface-subtle)" }}>
                {webhookSample(page)}
              </pre>
            </Panel>

            <Panel title="Visits" description="As reported by the page's analytics.">
              <ActionForm action={addPageViews.bind(null, page.id)} className="flex gap-2">
                <input name="views" type="number" min={1} max={1000000} required className="field" placeholder="Visits to add" aria-label="Visits" />
                <SubmitButton size="sm" tone="ghost">
                  Add
                </SubmitButton>
              </ActionForm>
            </Panel>

            <details className="disclosure surface">
              <summary className="px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                Edit name and slug…
              </summary>
              <ActionForm action={updateLandingPage.bind(null, page.id)} className="space-y-2 px-4 pb-4">
                <input name="name" defaultValue={page.name} required maxLength={200} className="field" aria-label="Page name" />
                <input name="slug" defaultValue={page.slug} required maxLength={80} className="field" aria-label="Slug" />
                <SubmitButton size="sm">Save</SubmitButton>
              </ActionForm>
            </details>

            {!live && page.submissions === 0 && (
              <details className="disclosure surface">
                <summary className="px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--negative)" }}>
                  Delete…
                </summary>
                <ActionForm action={deleteLandingPage.bind(null, page.id)} className="px-4 pb-4">
                  <SubmitButton size="sm" tone="danger">
                    Yes, delete /{page.slug}
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
