// Result handling for admin_convert_demo_request_to_lead (20261017180000_demo_request_to_sales_lead.sql).
// The database decides whether a lead is created, linked to an existing one, or already linked; this
// only validates the JSON it returns and words the outcome for the admin. Pure, so it is unit-tested.

export type DemoConversionResult = {
  leadId: string;
  created: boolean;
  alreadyLinked: boolean;
  leadName: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseDemoConversionResult(raw: unknown): DemoConversionResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.lead_id !== "string" || !UUID_RE.test(r.lead_id)) return null;
  return {
    leadId: r.lead_id,
    created: r.created === true,
    alreadyLinked: r.already_linked === true,
    leadName: typeof r.lead_name === "string" && r.lead_name.trim() ? r.lead_name : null,
  };
}

export function describeDemoConversion(r: DemoConversionResult): string {
  if (r.alreadyLinked) return "This request is already in the sales pipeline.";
  if (r.created) return "Added to the sales pipeline. A follow-up is due today.";
  return r.leadName
    ? `Linked to the existing lead "${r.leadName}" instead of creating a duplicate.`
    : "Linked to an existing lead instead of creating a duplicate.";
}
