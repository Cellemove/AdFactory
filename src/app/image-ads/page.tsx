import { supabase } from "@/lib/db";
import type { ResearchRow } from "@/lib/database.types";
import { IMAGE_AD_BATCH_TYPE, parseImageAdBatchDoc } from "@/lib/cellumove/image-ad-batch";
import { imageAdReferencesReady } from "@/lib/cellumove/image-ad-references";
import { ImageAdsIndexClient, type BatchSummary, type ProductOption, type SubOption } from "./ImageAdsIndexClient";

export const dynamic = "force-dynamic";

export default async function ImageAdsPage() {
  const [anglesRes, subsRes, productsRes, batchesRes] = await Promise.all([
    supabase.from("Angle").select("id, slug, name"),
    supabase.from("SubAvatar").select("id, name, shortDesc, angleId"),
    supabase.from("Product").select("id, name").order("name"),
    supabase
      .from("Research")
      .select("id, focus, angleSlug, drafts, createdAt")
      .eq("type", IMAGE_AD_BATCH_TYPE)
      .order("createdAt", { ascending: false })
      .limit(50),
  ]);

  const angles = (anglesRes.data ?? []) as { id: string; slug: string; name: string }[];
  const angleById = new Map(angles.map((angle) => [angle.id, angle.name]));
  const subOptions: SubOption[] = ((subsRes.data ?? []) as {
    id: string;
    name: string;
    shortDesc: string | null;
    angleId: string;
  }[])
    .map((sub) => ({ id: sub.id, name: sub.name, angleName: angleById.get(sub.angleId) ?? "—" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const productOptions = ((productsRes.data ?? []) as ProductOption[]);

  const batches: BatchSummary[] = ((batchesRes.error ? [] : (batchesRes.data as Pick<ResearchRow,
    "id" | "focus" | "angleSlug" | "drafts" | "createdAt"
  >[])) ?? []).map((row) => {
    const doc = parseImageAdBatchDoc(row.drafts);
    const rendered = doc.candidates.flatMap((candidate) =>
      candidate.status === "ready" && candidate.imageUrl ? [candidate.imageUrl] : []);
    return {
      id: row.id,
      label: doc.label,
      avatarName: row.focus,
      angleSlug: row.angleSlug,
      createdAt: row.createdAt,
      targetCount: doc.targetCount,
      format: doc.format,
      referencesReady: imageAdReferencesReady(doc.references),
      plannedCount: doc.candidates.length,
      readyCount: rendered.length,
      // Show the ads themselves once any exist; until then, the references.
      thumbnails: (rendered.length ? rendered : doc.references.map((reference) => reference.archivedImageUrl)).slice(0, 4),
    };
  });

  return <ImageAdsIndexClient subOptions={subOptions} productOptions={productOptions} batches={batches} />;
}
