// Single source of truth for the free-trial offer's wording on the public
// marketing site, so every surface (nav, hero, pricing, contact, FAQ) says the
// same thing and can't drift apart.
//
// What actually happens, verified against the code (not assumed):
//  - /signup is fully self-serve and collects no payment details, so "no card
//    required" is literally true (src/app/signup/actions.ts).
//  - The trial length is 30 days: signUpSchool() calls start_trial_subscription
//    with p_trial_days: 30.
//  - When the trial ends, the daily billing cron (/api/cron/billing ->
//    expire_trials()) marks the subscription past_due and the school
//    suspended, which blocks sign-in until a plan is activated. Nothing in the
//    codebase deletes a school's data at that point.
// Copy below therefore claims only: 30 days, no card, and (in the FAQ) that
// sign-in pauses until a plan is agreed -- never "full features", since the
// trial starts on the Starter plan record.

export const TRIAL_HREF = "/signup";

// Short label for tight spaces (header button, mobile nav, footer).
export const TRIAL_CTA_SHORT = "Start Free Trial";

// Full label for hero / pricing / final-CTA buttons.
export const TRIAL_CTA_LABEL = "Start your 30-day free trial";

// The offer itself, reused as a supporting line under CTAs.
export const TRIAL_TERMS = "30-day free trial. No card required.";
