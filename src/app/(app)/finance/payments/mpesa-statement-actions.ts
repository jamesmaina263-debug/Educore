"use server";

import { getMpesaStatement } from "@/lib/finance/get-mpesa-statement";
import type { MpesaStatementResult } from "@/lib/finance/get-mpesa-statement";

/**
 * Read-only server action behind the Payments > "M-Pesa payments statement" export.
 * Never writes anything; all authorization is enforced inside getMpesaStatement()
 * (finance.read) plus the existing RLS on payments/students/streams.
 */
export async function getMpesaStatementAction(
  fromDate: string,
  toDate: string,
): Promise<{ error: string } | ({ success: true } & MpesaStatementResult)> {
  return getMpesaStatement(fromDate, toDate);
}
