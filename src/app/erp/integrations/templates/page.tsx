import { integrationTabs } from "@/components/erp/tabs";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, relativeTime } from "@/components/ui/primitives";
import { Hint, Tabs } from "@/components/ui/workflow";
import { createTemplate, deleteTemplate, saveTemplate } from "@/server/actions/integrations";
import { readMany } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * Message templates: WhatsApp templates as Meta approves them, and SMS
 * content templates on the TRAI DLT registry with their header and template
 * ID. Only an approved template can be sent.
 */
export default async function TemplatesPage() {
  const { data } = await readMany(["message_templates", "messages", "connectors", "payments", "telematics"] as const);
  const templates = [...data.message_templates].sort((a, b) => a.channel.localeCompare(b.channel) || a.name.localeCompare(b.name));
  const uses = (name: string) => data.messages.filter((m) => m.template === name).length;

  return (
    <ModuleScreen
      href="/erp/integrations"
      tabs={
        <Tabs
          current="/erp/integrations/templates"
          tabs={integrationTabs({ connectors: data.connectors.length, messages: data.messages.length, templates: templates.length, payments: data.payments.length, devices: data.telematics.length })}
        />
      }
      stats={[
        { label: "Templates", value: String(templates.length), hint: `${templates.filter((t) => t.channel === "WhatsApp").length} WhatsApp · ${templates.filter((t) => t.channel === "SMS").length} SMS` },
        { label: "Approved", value: String(templates.filter((t) => t.status === "Approved").length), hint: "Sendable now" },
        { label: "Pending approval", value: String(templates.filter((t) => t.status === "Pending").length), hint: "With Meta or the DLT operator", tone: templates.some((t) => t.status === "Pending") ? "info" : "neutral" },
        { label: "Rejected", value: String(templates.filter((t) => t.status === "Rejected").length), hint: "Messages using them fail", tone: templates.some((t) => t.status === "Rejected") ? "negative" : "neutral" },
      ]}
      toolbar={
        <Disclosure label="New template">
          <ActionForm action={createTemplate} resetOnSuccess className="grid gap-3 sm:grid-cols-3">
            <select name="channel" className="field" defaultValue="WhatsApp" aria-label="Channel">
              <option>WhatsApp</option>
              <option>SMS</option>
            </select>
            <input name="name" required maxLength={60} className="field" placeholder="name_in_snake_case" aria-label="Name" />
            <select name="category" className="field" defaultValue="Utility" aria-label="Category">
              {["Utility", "Marketing", "Authentication", "Transactional", "Service Implicit", "Promotional"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <textarea name="body" required maxLength={1000} rows={3} className="field sm:col-span-3" placeholder="WhatsApp placeholders {{1}}, {{2}}… · SMS variables {#var#}" aria-label="Body" />
            <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
              <SubmitButton>Submit for approval</SubmitButton>
              <Hint>WhatsApp: utility, marketing or authentication. SMS on DLT: transactional, service or promotional, sent under a registered 6-letter header.</Hint>
            </div>
          </ActionForm>
        </Disclosure>
      }
    >
      <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
        {templates.map((t) => (
          <li key={t.id} className="px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="num font-semibold">{t.name}</span>
              <Pill tone={t.channel === "WhatsApp" ? "positive" : "neutral"}>{t.channel}</Pill>
              <Pill tone="neutral">{t.category}</Pill>
              <StatusPill value={t.status} />
              {t.senderId && <Pill tone="brand">{t.senderId}</Pill>}
              <span className="ml-auto text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
                {uses(t.name)} sent · updated {relativeTime(t.updatedAt)}
              </span>
            </div>
            <ActionForm action={saveTemplate.bind(null, t.id)} className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_12rem_10rem_auto]">
              <textarea name="body" defaultValue={t.body} maxLength={1000} rows={2} className="field" aria-label={`${t.name} body`} />
              {t.channel === "SMS" ? (
                <input name="dltTemplateId" defaultValue={t.dltTemplateId ?? ""} maxLength={19} className="field num" placeholder="DLT template ID" aria-label="DLT template ID" />
              ) : (
                <span />
              )}
              <select name="status" defaultValue={t.status} className="field" aria-label="Approval status">
                <option>Approved</option>
                <option>Pending</option>
                <option>Rejected</option>
              </select>
              <SubmitButton size="sm" tone="ghost">
                Save
              </SubmitButton>
            </ActionForm>
            {/* Nothing has ever been sent on it, so removing it loses no history. */}
            {uses(t.name) === 0 && (
              <ActionForm action={deleteTemplate.bind(null, t.id)} className="mt-2">
                <SubmitButton size="sm" tone="danger">
                  Delete template
                </SubmitButton>
              </ActionForm>
            )}
          </li>
        ))}
      </ul>
    </ModuleScreen>
  );
}
