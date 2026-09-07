// Analyzed competitor-intel briefs from the "Intelligence Industrielle" Drive.
// One Research row (type "competitor_intel") holds the whole doc as JSON, keyed
// by Drive folder id — same single-doc pattern as the sheet-winners analysis, so
// no migration is needed. Written by scripts/analyze-intel-drive.ts; read by /spy.
import { supabase, newId } from "@/lib/db";

export const INTEL_RESEARCH_TYPE = "competitor_intel";

export interface IntelBrief {
  brand: string;
  folderPath: string;
  summary: string;
  filesHash: string;
  fileCount: number;
  analyzedAt: string;
}

export interface IntelBriefDoc {
  brands: Record<string, IntelBrief>;
}

export async function loadIntelBriefDoc(): Promise<{ id: string; doc: IntelBriefDoc } | null> {
  const res = await supabase
    .from("Research")
    .select("id, drafts")
    .eq("type", INTEL_RESEARCH_TYPE)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error || !res.data) return null;
  try {
    const doc = JSON.parse((res.data as { drafts: string }).drafts) as Partial<IntelBriefDoc>;
    return { id: (res.data as { id: string }).id, doc: { brands: doc.brands ?? {} } };
  } catch {
    return null;
  }
}

/** Save the doc; pass null id to create the row. Returns the row id. */
export async function saveIntelBriefDoc(id: string | null, doc: IntelBriefDoc): Promise<string> {
  if (id) {
    const res = await supabase.from("Research").update({ drafts: JSON.stringify(doc) }).eq("id", id);
    if (res.error) throw new Error(res.error.message);
    return id;
  }
  const rowId = newId();
  const res = await supabase.from("Research").insert({
    id: rowId,
    type: INTEL_RESEARCH_TYPE,
    angleSlug: null,
    focus: null,
    drafts: JSON.stringify(doc),
    queryPlan: { kind: "intel_drive_analysis" },
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  if (res.error) throw new Error(res.error.message);
  return rowId;
}

/** Loose brand key for lookups: lowercased alphanumerics only. */
export function normalizeBrandKey(brand: string): string {
  return brand.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const ADS_LIBRARY_RE = /https:\/\/www\.facebook\.com\/ads\/library\/\?\S+view_all_page_id=\d+/g;

/**
 * Brand → Meta Ads Library page URL, mined from each brief's LINKS line. These
 * are the one Facebook link we can trust (they always show the brand's live
 * running ads), used to replace model-fabricated post/reel URLs.
 */
export function extractAdsLibraryLinks(doc: IntelBriefDoc | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of Object.values(doc?.brands ?? {})) {
    const url = b.summary.match(ADS_LIBRARY_RE)?.[0];
    if (url) out[normalizeBrandKey(b.brand)] = url;
  }
  return out;
}

/** Per-brand briefs as a prompt block, alphabetical, capped. */
// ponytail: flat char cap — if the drive outgrows it, rank briefs by niche relevance instead.
export function renderIntelBriefs(doc: IntelBriefDoc | null | undefined, capChars = 100000): string {
  if (!doc || !Object.keys(doc.brands).length) return "";
  return Object.values(doc.brands)
    .sort((a, b) => a.brand.localeCompare(b.brand))
    .map((b) => `## ${b.brand}\n${b.summary}`)
    .join("\n\n")
    .slice(0, capChars);
}
