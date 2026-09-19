#!/usr/bin/env node
/**
 * cleanup-vercel-deployments.mjs
 *
 * Safely prunes old, non-production EduCore deployments to free up
 * Vercel Hobby-plan Functions Storage / Deployment Storage.
 *
 * SAFETY:
 *  - Dry-run by default. Prints what WOULD be deleted; deletes nothing.
 *  - Pass --execute to actually delete.
 *  - Never touches: the current production deployment, any deployment
 *    marked isRollbackCandidate, or anything newer than --keep-days.
 *  - Deleting a Vercel deployment only removes build/function artifacts
 *    stored by Vercel. It does NOT touch GitHub, your source code, or
 *    your Supabase database in any way.
 *
 * SETUP (run on your own machine, not in any sandbox):
 *  1. Create a token at https://vercel.com/account/tokens
 *     (scope it to the "jamesmaina263-debug's projects" team if it asks).
 *  2. export VERCEL_TOKEN=your_token_here
 *  3. node cleanup-vercel-deployments.mjs                # dry run, 14-day buffer
 *  4. node cleanup-vercel-deployments.mjs --execute       # actually delete
 *
 * OPTIONS:
 *  --keep-days N     Don't touch anything newer than N days old (default 14)
 *  --execute         Actually delete (default: dry run only)
 *  --project-id ID   Override the default educore project ID
 *  --team-id ID      Override the default team ID
 */

const TOKEN = process.env.VERCEL_TOKEN;
if (!TOKEN) {
  console.error("Set VERCEL_TOKEN first: export VERCEL_TOKEN=your_token_here");
  process.exit(1);
}

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const getArg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const PROJECT_ID = getArg("--project-id", "prj_9QO9X7OtwbaXLKXhgsBaxJ5bqz1f"); // educore
const TEAM_ID = getArg("--team-id", "team_8KWe48KmYiJaXSF5WIvbxZPi");
const KEEP_DAYS = Number(getArg("--keep-days", "14"));
const KEEP_CUTOFF_MS = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;

const API = "https://api.vercel.com";
const headers = { Authorization: `Bearer ${TOKEN}` };

async function listAllDeployments() {
  const all = [];
  let until;
  for (;;) {
    const url = new URL(`${API}/v6/deployments`);
    url.searchParams.set("projectId", PROJECT_ID);
    url.searchParams.set("teamId", TEAM_ID);
    url.searchParams.set("limit", "100");
    if (until) url.searchParams.set("until", String(until));

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`List failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    all.push(...data.deployments);

    const next = data.pagination?.next;
    if (!next || data.deployments.length === 0) break;
    until = next;
  }
  return all;
}

async function deleteDeployment(id) {
  const url = new URL(`${API}/v13/deployments/${id}`);
  url.searchParams.set("teamId", TEAM_ID);
  const res = await fetch(url, { method: "DELETE", headers });
  if (!res.ok) {
    throw new Error(`Delete failed for ${id}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

const deployments = await listAllDeployments();
console.log(`Found ${deployments.length} total deployments.\n`);

const keep = [];
const candidates = [];

for (const d of deployments) {
  const reasons = [];
  if (d.target === "production") reasons.push("production");
  if (d.isRollbackCandidate) reasons.push("rollback candidate");
  if (d.created >= KEEP_CUTOFF_MS) reasons.push(`newer than ${KEEP_DAYS}d`);

  if (reasons.length) {
    keep.push({ d, reasons });
  } else {
    candidates.push(d);
  }
}

console.log(`Keeping ${keep.length} deployments (production / rollback candidates / within ${KEEP_DAYS} days).`);
console.log(`${EXECUTE ? "Deleting" : "Would delete"} ${candidates.length} old, non-production deployments:\n`);

for (const d of candidates) {
  const date = new Date(d.created).toISOString().slice(0, 10);
  console.log(`  ${date}  ${d.id}  ${d.url}`);
}

if (!EXECUTE) {
  console.log(`\nDry run only. Re-run with --execute to actually delete these ${candidates.length} deployments.`);
  process.exit(0);
}

console.log("\nDeleting...");
let deleted = 0;
for (const d of candidates) {
  try {
    await deleteDeployment(d.id);
    deleted++;
    console.log(`  deleted ${d.id}`);
  } catch (err) {
    console.error(`  FAILED ${d.id}: ${err.message}`);
  }
}
console.log(`\nDone. Deleted ${deleted}/${candidates.length}.`);
