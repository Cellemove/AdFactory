import { supabase, unwrap, unwrapOpt } from "@/lib/db";
import type { SubAvatarRow, AngleRow, AvatarResearchRow, WinningAdRow } from "@/lib/database.types";
import { Wizard } from "./Wizard";
import { isLLMConfigured } from "@/lib/llm";

type SubWithResearchAngle = SubAvatarRow & { research: AvatarResearchRow | null; angle: AngleRow };
type WinnerWithAngle = WinningAdRow & { angle: AngleRow };

export const dynamic = "force-dynamic";

export default async function NewRunPage() {
  const [anglesRes, subsRes, winnersRes, swingsRes, settingsRes] = await Promise.all([
    supabase.from("Angle").select("*").order("order", { ascending: true }),
    supabase
      .from("SubAvatar")
      .select("*, research:AvatarResearch(*), angle:Angle(*)")
      .order("name", { ascending: true }),
    supabase
      .from("WinningAd")
      .select("*, angle:Angle(*)")
      .order("createdAt", { ascending: false }),
    supabase.from("BigSwing").select("*").order("order", { ascending: true }),
    supabase.from("Settings").select("*").eq("id", "default").maybeSingle(),
  ]);
  const angles = unwrap(anglesRes);
  const subAvatars = unwrap(subsRes) as SubWithResearchAngle[];
  const winners = unwrap(winnersRes) as WinnerWithAngle[];
  const bigSwings = unwrap(swingsRes);
  const settings = unwrapOpt(settingsRes);

  return (
    <Wizard
      apiConfigured={isLLMConfigured()}
      angles={angles.map((a) => ({ id: a.id, slug: a.slug, name: a.name }))}
      subAvatars={subAvatars.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        shortDesc: s.shortDesc,
        angleSlug: s.angle.slug,
        hasResearch: Boolean(s.research),
      }))}
      winners={winners.map((w) => ({
        id: w.id,
        adName: w.adName,
        headline: w.headline,
        angleSlug: w.angle.slug,
        funnel: w.funnel,
        adType: w.adType ?? "static",
        hookType: w.hookType,
      }))}
      bigSwings={bigSwings.map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        format: b.format,
        funnel: b.funnel,
        description: b.description,
        visualSpec: b.visualSpec,
        headlineOptions: JSON.parse(b.headlineOptions) as string[],
      }))}
      defaultTargetCount={settings?.defaultTargetCount ?? 25}
    />
  );
}
