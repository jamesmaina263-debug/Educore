-- Real default plans for the platform. Pricing is a placeholder set by the
-- business (per-student-per-term KES), not blueprint-specified — flagged as
-- a business decision to revisit, not a technical one.
insert into subscription_plans (code, name, description, price_per_student_kes, billing_period, max_students, features) values
  ('starter', 'Starter', 'For small schools getting started with EduCore.', 150, 'termly', 200, '{"modules": ["core","academics","finance"]}'),
  ('growth', 'Growth', 'For established schools needing the full feature set.', 200, 'termly', 800, '{"modules": ["core","academics","finance","payroll","library","transport","hostel","inventory","communication"]}'),
  ('enterprise', 'Enterprise', 'For large schools and school groups, including AI features.', 250, 'termly', null, '{"modules": ["all"], "ai": true}');
