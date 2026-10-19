// Manual approval of self-signup schools (schools.signup_review_status).
//
// A new self-signup is created 'pending': its owner can set a password and sign in, but every school-app
// request is held on /pending-approval until a platform admin approves it. A rejected school is signed out
// with a "not approved" message and the school is kept. Everything that already existed is 'approved' (the
// column default), so this only ever affects schools created by the signup form after this shipped.

export type SignupReviewStatus = "pending" | "approved" | "rejected";
export type SignupReviewGate = "allow" | "pending" | "rejected";

export const PENDING_APPROVAL_PATH = "/pending-approval";

export const NOT_APPROVED_MESSAGE =
  "Your school's signup was not approved. If you think this is a mistake, please contact EduCore.";

/**
 * Decide what a signed-in staff member of a school should be allowed to do.
 * Anything that is not clearly 'pending' or 'rejected' (approved, missing, an unexpected value, a column the
 * database does not have yet) is allowed: this gate must never lock out an established school by accident.
 */
export function signupReviewGate(status: unknown): SignupReviewGate {
  if (status === "pending") return "pending";
  if (status === "rejected") return "rejected";
  return "allow";
}

export function isSignupReviewDecision(value: unknown): value is "approved" | "rejected" {
  return value === "approved" || value === "rejected";
}
