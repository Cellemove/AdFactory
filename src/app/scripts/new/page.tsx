import type { Metadata } from "next";
import { requireStrategist } from "@/lib/authorization";
import { SCRIPT_FORMATS } from "@/lib/cellumove/script-studio";
import { supabase, unwrap } from "@/lib/db";
import { isTeardownConfigured, listTeardownDeconstructions } from "@/lib/teardown";
import { ScriptProjectForm } from "./ScriptProjectForm";

export const metadata: Metadata = { title: "New Script · AdFactory" };
export const dynamic = "force-dynamic";

export default async function NewScriptPage() {
  const currentUser = await requireStrategist();
  const [products, angles, avatars, frameworks, users] = await Promise.all([
    supabase
      .from("Product")
      .select("id, name, code, imagePath")
      .not("code", "is", null)
      .neq("code", "")
      .order("name")
      .then(unwrap),
    supabase.from("Angle").select("*").order("order").then(unwrap),
    supabase.from("SubAvatar").select("*").order("name").then(unwrap),
    supabase.from("ReferenceFormat").select("*").order("order").then(unwrap),
    supabase.from("AppUser").select("*").order("username").then(unwrap),
  ]);

  let teardowns: Awaited<ReturnType<typeof listTeardownDeconstructions>> = [];
  let teardownWarning: string | null = null;
  if (isTeardownConfigured()) {
    try {
      teardowns = await listTeardownDeconstructions();
    } catch (error) {
      teardownWarning = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Create script project</h1>
        <p className="mt-1 text-sm text-ink-500">Choose the strategy inputs first; AI uses your product, avatar research, verbatims, knowledge, winners, Teardown, and B-roll to deliver a complete editable first draft.</p>
      </header>
      <ScriptProjectForm
        products={products
          .filter((item) => item.code?.trim())
          .map((item) => ({ id: item.id, name: item.name, code: item.code!.trim(), imagePath: item.imagePath }))}
        angles={angles.map((item) => ({ id: item.id, name: item.name }))}
        avatars={avatars.map((item) => ({ id: item.id, angleId: item.angleId, name: item.name }))}
        frameworks={frameworks.map((item) => ({ id: item.id, name: item.name, duration: item.optimalDurationSec }))}
        strategists={users.filter((item) => item.role === "creative_strategist").map((item) => ({ id: item.id, name: item.username }))}
        editors={users.filter((item) => item.role === "editor").map((item) => ({ id: item.id, name: item.username }))}
        teardowns={teardowns.map((item) => ({
          id: item.id,
          name: `${item.ad_name || item.original_filename} · ${item.platform || item.ad_kind} · ${item.field_count} insights`,
        }))}
        formats={[...SCRIPT_FORMATS]}
        currentUserId={currentUser.id}
        teardownConfigured={isTeardownConfigured()}
        teardownWarning={teardownWarning}
      />
    </div>
  );
}
