import Link from "next/link";
import { supabase } from "@/lib/db";
import type {
  AngleRow,
  CompetitorAdRow,
  ProductRow,
  ResearchRow,
  SubAvatarRow,
} from "@/lib/database.types";
import {
  IMAGE_AD_BATCH_TYPE,
  IMAGE_AD_FORMATS,
  imageAdModelProfile,
  parseImageAdBatchDoc,
} from "@/lib/cellumove/image-ad-batch";
import type { ImageAdReferenceOption } from "@/lib/cellumove/image-ad-references";
import { BatchWorkspace } from "./BatchWorkspace";
import { DeleteBatchButton } from "./DeleteBatchButton";

export const dynamic = "force-dynamic";
// Saving references and planning concepts are long single server actions — give
// them room on Vercel (no effect locally).
export const maxDuration = 300;

type CandidateAd = Pick<CompetitorAdRow,
  "id" | "provider" | "brandName" | "platform" | "sourceUrl" | "mediaType" | "imageUrl" | "copy" | "winnerEvidence" | "evidenceReasons" | "metrics"
>;

export default async function ImageAdBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const row = (await supabase
    .from("Research")
    .select("*")
    .eq("id", id)
    .eq("type", IMAGE_AD_BATCH_TYPE)
    .maybeSingle()).data as ResearchRow | null;

  if (!row) {
    return (
      <div className="card text-sm text-ink-600">
        Image ad batch not found.{" "}
        <Link href="/image-ads" className="underline hover:text-ink-900">Back to the bank</Link>
      </div>
    );
  }

  const doc = parseImageAdBatchDoc(row.drafts);

  const [subRes, angleRes, productRes, adsRes] = await Promise.all([
    supabase.from("SubAvatar").select("*").eq("id", doc.subAvatarId).maybeSingle(),
    supabase.from("Angle").select("*").eq("slug", doc.angleSlug).maybeSingle(),
    doc.productId
      ? supabase.from("Product").select("*").eq("id", doc.productId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // The pool the strategist picks from: BrandSearch image creatives that still
    // have live media and qualified as likely winners.
    supabase
      .from("CompetitorAd")
      .select("id, provider, brandName, platform, sourceUrl, mediaType, imageUrl, copy, winnerEvidence, evidenceReasons, metrics, lastSeenAt")
      .eq("provider", "brandsearch")
      .eq("mediaType", "image")
      .not("imageUrl", "is", null)
      .in("winnerEvidence", ["probable_winner", "verified_winner"])
      .gt("mediaExpiresAt", new Date().toISOString())
      .order("lastSeenAt", { ascending: false })
      .limit(160),
  ]);

  const sub = subRes.data as SubAvatarRow | null;
  const angle = angleRes.data as AngleRow | null;
  const product = productRes.data as ProductRow | null;

  const avatarName = sub?.name ?? row.focus ?? "Avatar";
  const angleName = angle?.name ?? doc.angleSlug;

  // Already-selected ads render from their archived copy, so the picker keeps
  // showing them after the BrandSearch media URL expires.
  const selectedById = new Map(doc.references.map((reference) => [reference.adId, reference]));
  const currentOptions = ((adsRes.data ?? []) as CandidateAd[]).flatMap((ad): ImageAdReferenceOption[] =>
    ad.imageUrl ? [{ ...ad, imageUrl: selectedById.get(ad.id)?.archivedImageUrl ?? ad.imageUrl }] : []);
  const optionIds = new Set(currentOptions.map((option) => option.id));
  const historicalOptions: ImageAdReferenceOption[] = doc.references
    .filter((reference) => !optionIds.has(reference.adId))
    .map((reference) => ({
      id: reference.adId,
      provider: reference.provider,
      brandName: reference.brandName,
      platform: reference.platform,
      sourceUrl: reference.sourceUrl,
      mediaType: "image",
      imageUrl: reference.archivedImageUrl,
      copy: reference.copy,
      winnerEvidence: reference.winnerEvidence,
      evidenceReasons: reference.evidenceReasons,
      metrics: reference.metrics,
    }));

  const profile = imageAdModelProfile();
  const formatLabel = IMAGE_AD_FORMATS.find((format) => format.value === doc.format)?.label ?? doc.format;

  return (
    <div className="space-y-5">
      <header>
        <Link href="/image-ads" className="text-xs text-ink-500 hover:text-ink-900">← AI Ads Image Bank</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{doc.label || `${avatarName} image ads`}</h1>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className="tag">{avatarName}</span>
              <span className="tag">{angleName}</span>
              {product && <span className="tag">{product.name}</span>}
              <span className="tag">{doc.targetCount} ads</span>
              <span className="tag">{formatLabel}</span>
            </div>
          </div>
          <DeleteBatchButton batchId={id} />
        </div>
      </header>

      <BatchWorkspace
        batchId={id}
        avatarName={avatarName}
        angleName={angleName}
        targetCount={doc.targetCount}
        format={doc.format}
        costPerImage={profile.costUsd}
        secondsPerImage={profile.secondsPerImage}
        options={[...historicalOptions, ...currentOptions]}
        initialReferences={doc.references}
        initialCandidates={doc.candidates}
      />
    </div>
  );
}
