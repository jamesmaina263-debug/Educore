import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unsubscribe | EduCore", robots: { index: false } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function confirmUnsubscribe(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  if (!UUID_RE.test(token)) return;
  await createAdminClient().rpc("unsubscribe_marketing_email", { p_token: token });
  redirect(`/unsubscribe/${token}?done=1`);
}

// Loading this page does NOT unsubscribe anyone (link scanners open emailed URLs); the person has
// to press the button. Rendering is identical for unknown tokens so they can't be probed.
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      {done ? (
        <>
          <h1 className="text-xl font-semibold">You&apos;re unsubscribed</h1>
          <p className="text-sm text-muted-foreground">
            You won&apos;t receive promotional emails from EduCore again. Account and billing messages for your
            school are unaffected.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Unsubscribe from EduCore emails?</h1>
          <p className="text-sm text-muted-foreground">
            You&apos;ll stop receiving promotional emails. Account and billing messages for your school will continue.
          </p>
          <form action={confirmUnsubscribe}>
            <input type="hidden" name="token" value={UUID_RE.test(token) ? token : ""} />
            <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Yes, unsubscribe me
            </button>
          </form>
        </>
      )}
    </main>
  );
}
