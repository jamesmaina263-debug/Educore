// After delete_school_permanently() has erased a school's database rows, two things remain that SQL
// cannot clean up safely:
//   1. the school's files in Supabase Storage (deleting storage.objects rows from SQL would leave the
//      real files behind), and
//   2. the school's login accounts in auth.users.
//
// Both run with the service-role client AFTER the database transaction has committed, and both are
// best-effort: a failure here never un-deletes the school, it is reported so an operator can finish
// the job. Both are tightly scoped -- Storage by the school's own id prefix (every bucket in this app
// stores objects under `<school_id>/...`), auth by the exact ids the database function returned as
// having no remaining references.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

type StorageEntry = { name: string; id: string | null };
type Bucket = { id: string; name: string };

// The slice of the supabase-js admin client this file uses, so tests can fake it.
export interface PurgeClient {
  storage: {
    listBuckets(): Promise<{ data: Bucket[] | null; error: { message: string } | null }>;
    from(bucket: string): {
      list(
        path: string,
        opts: { limit: number; offset: number },
      ): Promise<{ data: StorageEntry[] | null; error: { message: string } | null }>;
      remove(paths: string[]): Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
  auth: {
    admin: {
      deleteUser(id: string): Promise<{ error: { message: string } | null }>;
    };
  };
}

const PAGE = 1000;
const REMOVE_BATCH = 100;
const MAX_DEPTH = 12;
const MAX_FILES_PER_BUCKET = 200_000;

async function collectFiles(
  client: PurgeClient,
  bucket: string,
  prefix: string,
  depth: number,
  out: string[],
): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error(`folder nesting deeper than ${MAX_DEPTH} under ${prefix}`);
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(error.message);
    const entries = data ?? [];
    for (const entry of entries) {
      const full = `${prefix}/${entry.name}`;
      // Supabase lists a "folder" as an entry with no id.
      if (entry.id === null) await collectFiles(client, bucket, full, depth + 1, out);
      else out.push(full);
      if (out.length > MAX_FILES_PER_BUCKET) throw new Error("too many files to remove in one pass");
    }
    if (entries.length < PAGE) return;
  }
}

export type StorageCleanup = { filesRemoved: number; bucketsChecked: number; failures: string[] };

/** Remove every object under `<schoolId>/` in every bucket. Never throws; failures are returned. */
export async function removeSchoolFiles(
  client: PurgeClient,
  schoolId: string,
  /** Optional allow-list. When given, only these buckets are touched (used by the trial "start fresh" reset). */
  onlyBuckets?: readonly string[],
): Promise<StorageCleanup> {
  const result: StorageCleanup = { filesRemoved: 0, bucketsChecked: 0, failures: [] };
  // The id becomes a path prefix, so refuse anything that is not exactly a UUID (no "..", no empty prefix).
  if (!isUuid(schoolId)) {
    result.failures.push("Invalid school id; no files were touched.");
    return result;
  }

  const { data: buckets, error } = await client.storage.listBuckets();
  if (error || !buckets) {
    result.failures.push(`Could not list storage buckets: ${error?.message ?? "no data"}`);
    return result;
  }

  for (const bucket of onlyBuckets ? buckets.filter((b) => onlyBuckets.includes(b.name)) : buckets) {
    result.bucketsChecked += 1;
    try {
      const files: string[] = [];
      await collectFiles(client, bucket.name, schoolId, 0, files);
      for (let i = 0; i < files.length; i += REMOVE_BATCH) {
        const batch = files.slice(i, i + REMOVE_BATCH);
        const { error: rmError } = await client.storage.from(bucket.name).remove(batch);
        if (rmError) throw new Error(rmError.message);
        result.filesRemoved += batch.length;
      }
    } catch (e) {
      result.failures.push(`${bucket.name}: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }
  return result;
}

export type AuthCleanup = { removed: number; failures: string[] };

/** Delete the given login accounts. Never throws; ids that are not UUIDs are skipped and reported. */
export async function removeLoginAccounts(client: PurgeClient, ids: unknown): Promise<AuthCleanup> {
  const result: AuthCleanup = { removed: 0, failures: [] };
  const list = Array.isArray(ids) ? ids : [];
  for (const id of list) {
    if (!isUuid(id)) {
      result.failures.push("Skipped a malformed account id.");
      continue;
    }
    try {
      const { error } = await client.auth.admin.deleteUser(id);
      if (error) result.failures.push(`${id}: ${error.message}`);
      else result.removed += 1;
    } catch (e) {
      result.failures.push(`${id}: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }
  return result;
}
