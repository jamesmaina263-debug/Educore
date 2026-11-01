import type { SupabaseClient } from "@supabase/supabase-js";

// Flag keys follow one convention across the platform: lowercase segments joined by dots, e.g.
// "feature.finance.c2b_capture". The platform_feature_flags catalog already enforces
// case-insensitive uniqueness; this check just stops obviously malformed keys reaching the
// database and keeps naming consistent.
const FLAG_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

export function isValidFeatureFlagKey(key: string): boolean {
  return FLAG_KEY_RE.test(key);
}

/**
 * Is the named feature flag enabled for the CALLING USER'S OWN school?
 *
 * Fails closed: an invalid key, a missing flag, a missing row, no school on the caller, a
 * database error or a thrown exception all return false, so a gated feature stays off rather
 * than switching on by accident. It never throws.
 *
 * This only ever answers for the caller's own school (the database function takes no school
 * id), so it cannot be used to read another school's flags. For service-role contexts such as
 * edge functions and cron jobs, call the existing school_has_feature_flag(school_id, key)
 * instead.
 */
export async function hasFeatureFlag(supabase: SupabaseClient, key: string): Promise<boolean> {
  if (!isValidFeatureFlagKey(key)) return false;
  try {
    const { data, error } = await supabase.rpc("my_school_has_feature_flag", { p_key: key });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}
