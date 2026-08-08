import { supabase, unwrapOpt } from "@/lib/db";
import { SettingsForm } from "./SettingsForm";
import { isLLMConfigured, DEFAULT_MODEL } from "@/lib/llm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const sRes = await supabase.from("Settings").select("*").eq("id", "default").maybeSingle();
  const s = unwrapOpt(sRes);
  const apiOk = isLLMConfigured();
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-ink-500">Single-row table. API keys live in <code>.env</code>, never the DB.</p>
      </header>

      <div className="card">
        <h2 className="text-sm font-semibold">Gemini on Vertex AI</h2>
        <div className="divider" />
        <p className="text-sm">
          Status:{" "}
          {apiOk ? (
            <span className="tag tag-ok">configured</span>
          ) : (
            <span className="tag tag-danger">missing</span>
          )}
        </p>
        <p className="mt-2 text-xs text-ink-500">
          Set <code>GOOGLE_CLOUD_PROJECT</code> in <code>.env</code> and restart the dev server. Model: <code>{DEFAULT_MODEL}</code>.
        </p>
      </div>

      <SettingsForm
        initial={{
          brandWordmarkPath: s?.brandWordmarkPath ?? "",
          referenceImagePath: s?.referenceImagePath ?? "",
          defaultEditor: (s?.defaultEditor ?? "MO") as "MO" | "VA" | "DO",
          defaultTargetCount: s?.defaultTargetCount ?? 25,
          allowedSkinTones: s?.allowedSkinTones ?? "Latina,White,Middle Eastern,Asian",
        }}
      />
    </div>
  );
}
