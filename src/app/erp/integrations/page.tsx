import { integrationTabs } from "@/components/erp/tabs";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, relativeTime } from "@/components/ui/primitives";
import { SimulatedNote, Tabs } from "@/components/ui/workflow";
import { CONNECTOR_CATALOGUE } from "@/lib/connectors";
import { isToday } from "@/lib/time";
import { addConnector, setConnectorStatus, updateConnectorConfig } from "@/server/actions/integrations";
import { readMany } from "@/server/store";

export const dynamic = "force-dynamic";

const CONFIG_LABEL: Record<string, string> = {
  businessNumber: "Business number",
  wabaId: "WhatsApp Business account",
  senderId: "DLT header",
  entityId: "DLT entity ID",
  merchant: "Merchant name",
  settlement: "Settlement account",
  provider: "Device provider",
  pollMinutes: "Poll interval (min)",
  company: "Company",
  voucherSeries: "Voucher series",
  dealerPointId: "Dealer point ID",
  gstin: "GSTIN",
  userId: "Portal user",
  portal: "Helpdesk portal",
  department: "Default department",
};

/**
 * API integrations — every external system the platform talks to, with its
 * status, what it actually is, and its settings. Credentials never appear
 * here; only whether they are set in the deployment's secret store.
 *
 * Cards come from the catalogue in `lib/connectors.ts`, so a connector the
 * platform knows about is listed even before anyone sets it up — with the
 * same explanation of what the outside system is.
 */
export default async function IntegrationsPage() {
  const { data } = await readMany(["connectors", "messages", "message_templates", "payments", "telematics"] as const);
  const rowFor = new Map(data.connectors.map((c) => [c.key, c] as const));
  const entries = CONNECTOR_CATALOGUE.map((profile) => ({ profile, connector: rowFor.get(profile.key) ?? null })).sort(
    (a, b) => a.profile.category.localeCompare(b.profile.category) || a.profile.name.localeCompare(b.profile.name),
  );
  const live = data.connectors.filter((c) => c.status === "Connected");
  const notLive = entries.filter((e) => e.connector?.status !== "Connected").map((e) => e.profile.name);

  return (
    <ModuleScreen
      href="/erp/integrations"
      tabs={
        <Tabs
          current="/erp/integrations"
          tabs={integrationTabs({
            connectors: entries.length,
            messages: data.messages.length,
            templates: data.message_templates.length,
            payments: data.payments.length,
            devices: data.telematics.length,
          })}
        />
      }
      stats={[
        {
          label: "Connected",
          value: `${live.length} of ${entries.length}`,
          hint: notLive.join(", ") || "Everything is live",
          tone: live.length < entries.length ? "warning" : "positive",
        },
        {
          label: "Messages today",
          value: String(data.messages.filter((m) => isToday(m.at)).length),
          hint: `${data.messages.filter((m) => m.status === "Failed").length} failed in all`,
        },
        {
          label: "Payments captured today",
          value: String(data.payments.filter((p) => p.capturedAt && isToday(p.capturedAt)).length),
          hint: `${data.payments.filter((p) => p.status === "Created").length} links open`,
        },
        {
          label: "Vehicles reporting",
          value: String(data.telematics.filter((t) => t.status === "Online").length),
          hint: `${data.telematics.length} devices`,
        },
      ]}
    >
      <div className="grid gap-3 p-4 md:grid-cols-2">
        {entries.map(({ profile, connector: c }) => (
          <article key={profile.key} className="surface flex flex-col gap-3 p-4" aria-label={profile.name}>
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[14px] font-semibold">{c?.name ?? profile.name}</h2>
                <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
                  {c?.provider ?? profile.provider} · {profile.category}
                </p>
              </div>
              <span className="flex flex-wrap justify-end gap-1">
                {c ? <StatusPill value={c.status} /> : <Pill tone="neutral">Not set up</Pill>}
                {c && <Pill tone={c.environment === "Production" ? "brand" : "neutral"}>{c.environment}</Pill>}
              </span>
            </header>

            <p className="text-[12px]">{profile.depends}</p>
            <p className="text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
              {c
                ? `Credentials ${c.credentialsSet ? "set in the secret store" : "not set"} · last event ${c.lastEventAt ? relativeTime(c.lastEventAt) : "never"}`
                : "No connector record yet — nothing in this platform is using it."}
            </p>
            {c?.lastError && (
              <p className="rounded-[8px] px-2.5 py-1.5 text-[12px]" style={{ background: "var(--negative-surface)", color: "var(--negative)" }}>
                {c.lastError}
              </p>
            )}

            {/* What the outside system is, for anyone meeting the name for the first time. */}
            <details className="rounded-[8px] px-2.5 py-2" style={{ background: "var(--surface-sunken)" }}>
              <summary className="cursor-pointer text-[12px] font-semibold">About {c?.provider ?? profile.provider}</summary>
              <ul className="mt-2 grid list-disc gap-1.5 pl-4 text-[12px] leading-[1.5]" style={{ color: "var(--fg-muted)" }}>
                {profile.about.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </details>

            <div className="mt-auto flex flex-wrap items-center gap-2">
              {c ? (
                <ActionForm action={setConnectorStatus.bind(null, c.id, c.status === "Connected" ? "Disconnected" : "Connected")}>
                  <SubmitButton size="sm" tone={c.status === "Connected" ? "ghost" : "primary"}>
                    {c.status === "Connected" ? "Disconnect" : "Connect"}
                  </SubmitButton>
                </ActionForm>
              ) : (
                <ActionForm action={addConnector.bind(null, profile.key)}>
                  <SubmitButton size="sm" tone="primary">
                    Set up
                  </SubmitButton>
                </ActionForm>
              )}
              {c && Object.keys(c.config).length > 0 && (
                <details className="w-full">
                  <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                    Settings…
                  </summary>
                  <ActionForm action={updateConnectorConfig.bind(null, c.id)} className="mt-2 grid gap-2 sm:grid-cols-2">
                    {Object.entries(c.config).map(([key, value]) => (
                      <div key={key}>
                        <label className="field-label" htmlFor={`${c.id}-${key}`}>
                          {CONFIG_LABEL[key] ?? key}
                        </label>
                        <input id={`${c.id}-${key}`} name={`config.${key}`} defaultValue={value} maxLength={120} className="field" />
                      </div>
                    ))}
                    <div>
                      <label className="field-label" htmlFor={`${c.id}-env`}>
                        Environment
                      </label>
                      <select id={`${c.id}-env`} name="environment" className="field" defaultValue={c.environment}>
                        <option>Sandbox</option>
                        <option>Production</option>
                      </select>
                    </div>
                    <div className="self-end">
                      <SubmitButton size="sm" tone="ghost">
                        Save settings
                      </SubmitButton>
                    </div>
                  </ActionForm>
                </details>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="px-4 pb-4">
        <SimulatedNote>
          Simulated: no outside service is called. Switching a connector off makes the flows that depend on it fail the way they would — messages bounce, e-way bills
          and Vahan filings are refused, vouchers queue — and switching it back on resumes them.
        </SimulatedNote>
      </div>
    </ModuleScreen>
  );
}
