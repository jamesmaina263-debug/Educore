"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import {
  MAX_SALE_LINES,
  validateAmount,
  validateItem,
  validateStockChange,
  type ItemInput,
  type Tender,
} from "@/lib/canteen";

type Plain = { error: string } | { success: true };

export interface SaleOutcome {
  saleId: string;
  total: number;
  balance: number | null;
  duplicate: boolean;
}
export interface MoneyOutcome {
  balance: number;
  amount: number;
  duplicate: boolean;
}
export interface Summary {
  sales_count: number;
  wallet_sales: number;
  cash_sales: number;
  voided_count: number;
  voided_total: number;
  deposits: number;
  refunds: number;
  wallet_liability: number;
  low_stock: { id: string; name: string; stock: number; reorder_level: number }[];
}

// Canteen / tuck shop (WP 8.5). Every action is a thin call to a database function that checks the caller, the
// school, the permission and the feature flag itself, and that is the authority on prices and balances. Nothing
// here takes an online payment: deposits and refunds are cash that staff hand over and type in.

const REF = /^[A-Za-z0-9_-]{1,64}$/;

export async function saveItemAction(input: ItemInput): Promise<Plain> {
  const checked = validateItem(input);
  if ("error" in checked) return { error: checked.error };
  const v = checked.value;
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("save_canteen_item", { p_id: v.id, p_name: v.name, p_price: v.price, p_reorder_level: v.reorderLevel, p_active: v.active });
  if (error) return { error: error.message };
  revalidatePath("/inventory/canteen");
  return { success: true };
}

export async function adjustStockAction(itemId: string, delta: string, reason: "received" | "adjustment", note: string): Promise<Plain> {
  if (!itemId) return { error: "Choose an item." };
  const checked = validateStockChange(delta, reason, note);
  if ("error" in checked) return { error: checked.error };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("adjust_canteen_stock", { p_item_id: itemId, p_delta: checked.value, p_reason: reason, p_note: note.trim() || null });
  if (error) return { error: error.message };
  revalidatePath("/inventory/canteen");
  return { success: true };
}

async function money(fn: "record_canteen_deposit" | "record_canteen_refund", studentId: string, amount: string, note: string, ref: string): Promise<{ error: string } | { success: true; result: MoneyOutcome }> {
  if (!studentId) return { error: "Choose a student." };
  if (!REF.test(ref)) return { error: "Missing request reference. Reload the page and try again." };
  const a = validateAmount(amount);
  if ("error" in a) return { error: a.error };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc(fn, { p_student_id: studentId, p_amount: a.value, p_note: note.trim() || null, p_client_ref: ref });
  if (error) return { error: error.message };
  const d = data as { balance: number; amount: number; duplicate: boolean };
  revalidatePath("/inventory/canteen");
  return { success: true, result: { balance: Number(d.balance), amount: Number(d.amount), duplicate: d.duplicate } };
}

export async function depositAction(studentId: string, amount: string, note: string, ref: string) {
  return money("record_canteen_deposit", studentId, amount, note, ref);
}

export async function refundAction(studentId: string, amount: string, note: string, ref: string) {
  if (note.trim().length === 0) return { error: "Say why this money is being paid out." } as const;
  return money("record_canteen_refund", studentId, amount, note, ref);
}

export async function saleAction(
  studentId: string,
  tender: Tender,
  lines: { item_id: string; qty: number }[],
  ref: string,
): Promise<{ error: string } | { success: true; result: SaleOutcome }> {
  if (tender !== "wallet" && tender !== "cash") return { error: "Choose wallet or cash." };
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_SALE_LINES) return { error: "Add between 1 and 40 items." };
  if (!REF.test(ref)) return { error: "Missing request reference. Reload the page and try again." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("record_canteen_sale", {
    p_student_id: studentId || null,
    p_tender: tender,
    p_lines: lines,
    p_client_ref: ref,
  });
  if (error) return { error: error.message };
  const d = data as { sale_id: string; total: number; balance: number | null; duplicate: boolean };
  revalidatePath("/inventory/canteen");
  return { success: true, result: { saleId: d.sale_id, total: Number(d.total), balance: d.balance === null ? null : Number(d.balance), duplicate: d.duplicate } };
}

export async function voidSaleAction(saleId: string, reason: string): Promise<Plain> {
  if (!saleId) return { error: "Missing sale." };
  if (reason.trim().length < 3) return { error: "Give a reason for the void." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("void_canteen_sale", { p_sale_id: saleId, p_reason: reason.trim() });
  if (error) return { error: error.message };
  revalidatePath("/inventory/canteen");
  return { success: true };
}

export async function summaryAction(from: string, to: string): Promise<{ error: string } | { success: true; summary: Summary }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { error: "Choose valid dates." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("canteen_summary", { p_from: from, p_to: to });
  if (error) return { error: error.message };
  return { success: true, summary: data as Summary };
}
