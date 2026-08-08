import { supabase } from "@/lib/db";
import type { ResearchRow } from "@/lib/database.types";
import type { ExcavationResult } from "../actions/excavate";
import { ExcavateClient } from "./ExcavateClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Avatar Excavation · CelluMove Ad Factory" };

function parse(row: Pick<ResearchRow, "drafts">): ExcavationResult | null {
  try {
    return JSON.parse(row.drafts) as ExcavationResult;
  } catch {
    return null;
  }
}

export default async function ExcavatePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;

  const [oneRes, recentRes] = await Promise.all([
    id
      ? supabase.from("Research").select("drafts").eq("id", id).eq("type", "excavation").maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("Research")
      .select("id, focus, drafts, createdAt")
      .eq("type", "excavation")
      .order("createdAt", { ascending: false })
      .limit(12),
  ]);

  const initial = oneRes.data ? parse(oneRes.data as Pick<ResearchRow, "drafts">) : null;

  const recent = ((recentRes.error ? [] : (recentRes.data as Pick<ResearchRow, "id" | "focus" | "drafts" | "createdAt">[])) ?? [])
    .map((r) => {
      const p = parse(r);
      return {
        id: r.id,
        avatarName: r.focus || p?.avatarName || "Avatar",
        subCount: p?.subAvatars?.length ?? 0,
        createdAt: r.createdAt,
      };
    });

  return <ExcavateClient initial={initial} recent={recent} />;
}
