import { supabase, unwrap } from "@/lib/db";
import type { WinningAdRow, AngleRow } from "@/lib/database.types";
import { performanceByWinner } from "../actions/performance";
import { getSheetWinnersDoc } from "../actions/sheet-winners";
import { summarizePerformance } from "@/lib/cellumove/performance";
import { WinnersClient } from "./WinnersClient";
import { SheetWinnersSection } from "./SheetWinnersSection";

type WinnerWithAngle = WinningAdRow & { angle: AngleRow };

export const dynamic = "force-dynamic";

export default async function WinnersPage() {
  const [anglesRes, winnersRes, perf, sheetDoc] = await Promise.all([
    supabase.from("Angle").select("*").order("order", { ascending: true }),
    supabase.from("WinningAd").select("*, angle:Angle(*)").order("createdAt", { ascending: false }),
    performanceByWinner(),
    getSheetWinnersDoc(),
  ]);
  const angles = unwrap(anglesRes);
  const winners = unwrap(winnersRes) as WinnerWithAngle[];

  return (
    <div className="space-y-10">
      <SheetWinnersSection doc={sheetDoc} />
      <WinnersClient
        angles={angles.map((a) => ({ slug: a.slug, name: a.name }))}
        winners={winners.map((w) => {
        const entries = perf[w.id] ?? [];
        return {
          id: w.id,
          adName: w.adName,
          funnel: w.funnel,
          adType: w.adType ?? "static",
          headline: w.headline,
          visualConcept: w.visualConcept,
          hookType: w.hookType,
          angleName: w.angle.name,
          angleSlug: w.angle.slug,
          notes: w.notes,
          imagePath: w.imagePath,
          createdAt: w.createdAt,
          kpiSummary: summarizePerformance(entries),
          kpis: entries.map((e) => ({
            id: e.id,
            date: e.date,
            spend: e.spend,
            roas: e.roas,
            ctr: e.ctr,
            cpa: e.cpa,
            purchases: e.purchases,
            impressions: e.impressions,
            notes: e.notes,
          })),
          };
        })}
      />
    </div>
  );
}
