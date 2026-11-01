"use server";

import { createClient } from "@/lib/supabase/server";
import { isValidMpesaCode, normalizeMpesaCode, parseMpesaCodeResult, type MpesaCodeResult } from "@/lib/mpesa-code-check";

/** Read-only lookup of one M-Pesa code for the caller's own school (database function enforces finance.read). */
export async function checkMpesaCodeAction(code: string): Promise<{ error: string } | { success: true; result: MpesaCodeResult }> {
  if (!isValidMpesaCode(code)) {
    return { error: "Enter the M-Pesa code exactly as it appears in the SMS (8 to 16 letters and digits)." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_mpesa_code", { p_code: normalizeMpesaCode(code) });
  if (error) return { error: error.message };
  const result = parseMpesaCodeResult(data);
  if (!result) return { error: "Unexpected response from the server." };
  return { success: true, result };
}
