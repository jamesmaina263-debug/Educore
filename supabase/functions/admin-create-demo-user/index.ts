// Neutralized 2026-08-20: this function was an orphaned manual deployment,
// never tracked in the repo, never referenced by any app code. It ran with
// the service-role key and, with NO auth check at all (verify_jwt was false),
// let anyone on the internet delete-and-recreate the real Demo Academy owner
// account (owner@demo-academy.test, role school_owner) with a hardcoded
// password baked into the function source. verify_jwt is now on, and the
// body is a stub regardless -- even a valid arbitrary JWT gets nothing.
//
// Kept as a stub instead of removed outright because this tool set has no
// function-delete operation; ask Lucy before restoring this for any reason.
//
// Backfilled into the repo 2026-08-23: this file was deployed and
// neutralized directly against production and never committed. This commit
// only adds the already-live stub source to version control -- it does not
// change the deployed function's behavior.

Deno.serve(() => {
  return new Response(
    JSON.stringify({ error: "Gone. This function was disabled for security reasons." }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  );
});
