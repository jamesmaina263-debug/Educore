"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { validateVoteHead, type MappingSource } from "@/lib/vote-heads";

type ActionResult = { error: string } | { success: true };

// Finance > Vote heads. Thin calls to database functions that check the caller, the school and the
// feature flag themselves. Nothing here changes an invoice, payment or expense.

export async function createVoteHeadAction(input: { code: string; name: string; kind: string }): Promise<ActionResult> {
  const checked = validateVoteHead(input);
  if ("error" in checked) return { error: checked.error };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("create_vote_head", {
    p_code: checked.value.code,
    p_name: checked.value.name,
    p_kind: checked.value.kind,
  });
  if (error) return { error: error.message };
  revalidatePath("/finance/vote-heads");
  return { success: true };
}

export async function setVoteHeadActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("set_vote_head_active", { p_vote_head_id: id, p_active: active });
  if (error) return { error: error.message };
  revalidatePath("/finance/vote-heads");
  return { success: true };
}

export async function mapVoteHeadAction(source: MappingSource, name: string, voteHeadId: string): Promise<ActionResult> {
  if (!name.trim() || !voteHeadId) return { error: "Choose a vote head." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("set_vote_head_mapping", { p_source: source, p_name: name, p_vote_head_id: voteHeadId });
  if (error) return { error: error.message };
  revalidatePath("/finance/vote-heads");
  return { success: true };
}

export async function unmapVoteHeadAction(source: MappingSource, name: string): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("remove_vote_head_mapping", { p_source: source, p_name: name });
  if (error) return { error: error.message };
  revalidatePath("/finance/vote-heads");
  return { success: true };
}
