"use client";

import { useState, useTransition } from "react";
import { approveOnboardingTemplates, saveOnboardingMilestone, saveOnboardingSettings } from "@/app/(admin)/admin/onboarding/actions";
import { Button } from "@/components/ui/button";
import { NO_ONE, TeamSelect, type Team } from "@/components/admin/onboarding/team-select";
import { formatDateTime, type OnboardingConfig } from "@/lib/onboarding/onboarding";

// Automation settings. Automatic email is OFF until a super admin has (1) approved the exact wording of the two
// templates, (2) switched the monitor on here, and (3) the trial message sending switch is on. Alerts for the team
// never depend on any of this.

function Num({ label, value, onChange, min, max }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className="h-8 w-24 rounded-md border border-input bg-background px-2 text-[0.8125rem] text-foreground"
      />
    </label>
  );
}

export function OnboardingSettingsPanel({ config, team }: { config: OnboardingConfig; team: Team }) {
  const s = config.settings;
  const [actor, setActor] = useState(NO_ONE);
  const [enabled, setEnabled] = useState(s.automation_enabled);
  const [pwHours, setPwHours] = useState(s.password_reminder_hours);
  const [pwFlag, setPwFlag] = useState(s.password_flag_hours);
  const [loginHours, setLoginHours] = useState(s.login_guidance_hours);
  const [noSetup, setNoSetup] = useState(s.no_setup_flag_hours);
  const [inactive, setInactive] = useState(s.inactive_days);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ error: string } | { success: true }>, okText: string) {
    setMsg(null);
    if (actor === NO_ONE) {
      setMsg({ ok: false, text: "Pick your name first." });
      return;
    }
    start(async () => {
      const res = await fn();
      setMsg("error" in res ? { ok: false, text: res.error } : { ok: true, text: okText });
    });
  }

  const blockers: string[] = [];
  if (!config.templates_approved) blockers.push("the two email templates have not been approved");
  if (!s.automation_enabled) blockers.push("automatic emails are switched off below");
  if (!config.trial_nudge_sending_enabled) blockers.push("sending is switched off on the Trial messages page");

  return (
    <section aria-labelledby="settings-heading" className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="settings-heading" className="text-sm font-semibold">
            Automation
          </h2>
          <p className="text-xs text-muted-foreground">
            Status:{" "}
            <strong className={config.automation_active ? "text-emerald-800" : "text-amber-800"}>
              {config.automation_active ? "On: automatic emails can be sent" : "Off: no automatic emails are sent"}
            </strong>
            {!config.automation_active && blockers.length > 0 && <> because {blockers.join("; ")}.</>}
          </p>
        </div>
        <TeamSelect team={team} value={actor} onChange={setActor} />
      </div>

      {msg && (
        <p role="status" className={msg.ok ? "text-xs text-emerald-800" : "text-xs text-destructive"}>
          {msg.text}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold">1. Approve the two email templates</h3>
        <p className="text-xs text-muted-foreground">
          These are the only emails automation can ever send. Read the exact wording. If a template is ever changed, this approval lapses and sending pauses.
          {config.templates_approved && s.templates_approved_at ? ` Approved ${formatDateTime(s.templates_approved_at)}.` : " Not approved yet."}
        </p>
        {config.templates.map((t) => (
          <div key={t.rule_key} className="rounded border border-border bg-background p-2 text-xs">
            <div className="font-medium">{t.rule_key === "password_reminder_email" ? "Password reminder" : "Login guidance"}</div>
            <div className="text-muted-foreground">Subject: {t.subject}</div>
            <pre className="mt-1 whitespace-pre-wrap font-sans">{t.body}</pre>
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || config.templates_approved}
            onClick={() => run(() => approveOnboardingTemplates({ expectedHash: config.templates_hash, by: actor }), "Templates approved.")}
          >
            {config.templates_approved ? "Approved" : "Approve this exact wording"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold">2. Timing and switch</h3>
        <div className="flex flex-wrap items-end gap-3">
          <Num label="Password reminder after (hours)" value={pwHours} onChange={setPwHours} min={1} max={720} />
          <Num label="Flag password for a call after (hours)" value={pwFlag} onChange={setPwFlag} min={1} max={720} />
          <Num label="Login guidance after (hours)" value={loginHours} onChange={setLoginHours} min={1} max={720} />
          <Num label="Flag no-setup after (hours)" value={noSetup} onChange={setNoSetup} min={1} max={720} />
          <Num label="Inactive after (days)" value={inactive} onChange={setInactive} min={1} max={180} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Send the two automatic service emails
        </label>
        <p className="text-xs text-muted-foreground">
          Applies only to schools registered after {formatDateTime(s.automation_start_at)}. Existing schools are never emailed automatically.
        </p>
        <div>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  saveOnboardingSettings({
                    automationEnabled: enabled,
                    automationStartAt: s.automation_start_at,
                    passwordReminderHours: pwHours,
                    passwordFlagHours: pwFlag,
                    loginGuidanceHours: loginHours,
                    noSetupFlagHours: noSetup,
                    inactiveDays: inactive,
                    by: actor,
                  }),
                "Settings saved.",
              )
            }
          >
            Save settings
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold">Milestones that count toward progress</h3>
        <ul className="flex flex-col divide-y divide-border">
          {config.milestones.map((m) => (
            <MilestoneRow key={m.key} m={m} actor={actor} pending={pending} run={run} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function MilestoneRow({
  m,
  actor,
  pending,
  run,
}: {
  m: OnboardingConfig["milestones"][number];
  actor: string;
  pending: boolean;
  run: (fn: () => Promise<{ error: string } | { success: true }>, okText: string) => void;
}) {
  const [enabled, setEnabled] = useState(m.enabled);
  const [required, setRequired] = useState(m.required);
  const [weight, setWeight] = useState(m.weight);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
      <span>
        {m.label} <span className="text-xs text-muted-foreground">({m.grp === "setup" ? "setup" : "account"})</span>
      </span>
      <span className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Counts
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={required && enabled} disabled={!enabled} onChange={(e) => setRequired(e.target.checked)} /> Required
        </label>
        <label className="flex items-center gap-1">
          Weight
          <input
            type="number"
            min={1}
            max={10}
            value={Number.isFinite(weight) ? weight : ""}
            onChange={(e) => setWeight(e.target.valueAsNumber)}
            className="h-7 w-14 rounded-md border border-input bg-background px-1"
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => saveOnboardingMilestone({ key: m.key, enabled, required: required && enabled, weight, by: actor }), `${m.label} updated.`)}
        >
          Save
        </Button>
      </span>
    </li>
  );
}
