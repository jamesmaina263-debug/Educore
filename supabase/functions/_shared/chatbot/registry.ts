import type { ToolDefinition } from "./types.ts";
import type { BotIntent } from "./intents.ts";
import { feeBalanceTool } from "./tools/feeBalance.ts";
import { attendanceTool } from "./tools/attendance.ts";

// Only intents that resolve to an actual data-backed tool go here (greeting/escalate/unknown/
// switch_child are handled directly by the dispatcher, not via a tool). Adding results, report
// cards, timetable, announcements, calendar, or transport/boarding later is mechanical: write a
// tools/<name>.ts implementing ToolDefinition (query -> verified data -> templated text) and add
// one entry below -- disambiguation, authorization, and escalation-on-error are already handled
// by the dispatcher for every entry in this map, not re-implemented per tool.
export const TOOL_REGISTRY: Partial<Record<BotIntent, ToolDefinition>> = {
  fee_balance: feeBalanceTool,
  attendance: attendanceTool,
};
