import { describe, expect, it } from "vitest";
import { classifyIntent, STUDENT_SCOPED_INTENTS } from "../../../supabase/functions/_shared/chatbot/intents";

// With the flag OFF the classifier must behave exactly as it did before WhatsApp documents existed.
describe("classifyIntent: documents off (default)", () => {
  it.each([
    ["report card", "unknown"],
    ["results please", "unknown"],
    ["fee statement", "fee_balance"],
    ["statement", "unknown"],
    ["fee balance", "fee_balance"],
    ["attendance", "attendance"],
    ["hello", "greeting"],
    ["talk to someone", "escalate"],
  ])("%s -> %s", (text, expected) => {
    expect(classifyIntent(text)).toBe(expected);
    expect(classifyIntent(text, { documents: false })).toBe(expected);
  });
});

describe("classifyIntent: documents on", () => {
  it.each([
    ["report card", "report_card"],
    ["Send me the REPORT CARD", "report_card"],
    ["results", "report_card"],
    ["matokeo ya mtoto", "report_card"],
    ["statement", "statement"],
    ["fee statement", "statement"],
    ["statement of account", "statement"],
    // existing intents are untouched
    ["fee balance", "fee_balance"],
    ["balance", "fee_balance"],
    ["attendance", "attendance"],
    ["attendance report", "attendance"],
    ["hello", "greeting"],
    ["agent", "escalate"],
    ["switch to Sam", "switch_child"],
    // not a document request
    ["reporting for duty", "unknown"],
    ["1234", "unknown"],
  ])("%s -> %s", (text, expected) => {
    expect(classifyIntent(text, { documents: true })).toBe(expected);
  });

  it("document intents are student-scoped (so the child is disambiguated first)", () => {
    expect(STUDENT_SCOPED_INTENTS.has("report_card")).toBe(true);
    expect(STUDENT_SCOPED_INTENTS.has("statement")).toBe(true);
  });
});
