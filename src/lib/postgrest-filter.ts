/**
 * PostgREST's .or() filter takes a raw string like `col.ilike.%term%,col2.ilike.%term%` and
 * parses it itself -- commas separate conditions and parentheses group them. Interpolating
 * unescaped user input into that string lets a search term inject additional filter clauses
 * (e.g. a comma followed by another column.operator.value triple). RLS still bounds the blast
 * radius to whatever the caller could already see, but the filter itself shouldn't be
 * manipulable by what someone types into a search box.
 *
 * PostgREST's escape convention for a value is to wrap it in double quotes and backslash-escape
 * any embedded double quote or backslash: https://postgrest.org/en/stable/references/api/tables_views.html#operators
 * Wrapping in quotes also neutralizes commas and parentheses inside the value without stripping
 * or mangling legitimate characters in real names ("O'Brien", "St. Mary's", commas in a pasted
 * "Last, First" typo, etc.).
 */
export function escapePostgrestOrValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
