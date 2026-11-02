import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { WhatsAppPinForm } from "@/components/portal/whatsapp-pin-form";

// Where a guardian sets the PIN the school's WhatsApp bot asks for before it sends a report card or
// fee statement. Hidden (404) unless the school has feature.bot.documents on and the signed-in
// account is a parent; the database function set_bot_pin enforces the same rules again.
export default async function PortalWhatsAppPinPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/parent-login");

  const { data: schoolUser } = await supabase.from("school_users").select("roles(name)").eq("auth_user_id", user.id).maybeSingle();
  const roleName = (schoolUser?.roles as unknown as { name: string } | null)?.name;
  if (roleName !== "parent") notFound();
  if (!(await hasFeatureFlag(supabase, "feature.bot.documents"))) notFound();

  const { data: hasPin } = await supabase.rpc("bot_pin_is_set");

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 bg-background p-4">
      <Link href="/portal" className="text-xs text-muted-foreground underline">
        Back to portal
      </Link>
      <div className="panel p-4">
        <p className="label-eyebrow mb-2">WhatsApp documents</p>
        <p className="mb-4 text-sm text-muted-foreground">
          The school&apos;s WhatsApp number can send you your child&apos;s latest report card and fee statement. Before it does, it asks for this PIN, so
          nobody else who picks up your phone can open them. Do not share the PIN.
        </p>
        <WhatsAppPinForm hasPin={hasPin === true} />
      </div>
    </div>
  );
}
