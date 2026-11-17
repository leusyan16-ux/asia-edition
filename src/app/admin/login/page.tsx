import { redirect } from "next/navigation";
import { Login } from "@/features/admin/components";
import { commerceEnabled, commerceStaff } from "@/features/commerce/server";
import { AdminSessionRecovery } from "@/features/commerce/admin-session-recovery";
import { adminReturnPath } from "@/features/commerce/admin-navigation";
import {
  adminMode,
  currentAdmin,
  localIdentity,
} from "@/features/admin/server";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (commerceEnabled()) {
    const target = adminReturnPath((await searchParams).next);
    let allowed = false;
    try {
      await commerceStaff();
      allowed = true;
    } catch {}
    if (allowed) redirect(target);
    return <AdminSessionRecovery target={target} />;
  }
  if (await currentAdmin()) redirect("/admin");
  const mode = adminMode();
  const ready =
    mode === "local"
      ? Boolean(await localIdentity())
      : mode === "supabase" &&
        Boolean(
          process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        );
  return <Login ready={ready} mode={mode} />;
}
