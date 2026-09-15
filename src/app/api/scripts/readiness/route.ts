import { getSessionUser } from "@/lib/auth";
import type { AngleRow, ProductOfferRow, SubAvatarRow } from "@/lib/database.types";
import { supabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to check script readiness." }, { status: 401 });
  if (actor.role !== "creative_strategist") return Response.json({ error: "Only creative strategists can check script readiness." }, { status: 403 });

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId")?.trim() ?? "";
  const subAvatarId = url.searchParams.get("subAvatarId")?.trim() ?? "";
  const marketCode = url.searchParams.get("marketCode")?.trim().toUpperCase() ?? "";
  const offerId = url.searchParams.get("offerId")?.trim() || null;
  const referenceFormatId = url.searchParams.get("referenceFormatId")?.trim() || null;
  const teardownRecordId = url.searchParams.get("teardownRecordId")?.trim() || null;
  const funnelStage = url.searchParams.get("funnelStage")?.trim().toUpperCase() ?? "MOFU";
  if (!productId || !subAvatarId || !/^[A-Z]{2,12}$/.test(marketCode)) {
    return Response.json({ error: "Product, avatar, and market are required." }, { status: 400 });
  }

  const avatarResult = await supabase.from("SubAvatar").select("*").eq("id", subAvatarId).maybeSingle();
  const avatar = avatarResult.data as SubAvatarRow | null;
  if (!avatar) return Response.json({ error: "The selected avatar is unavailable." }, { status: 400 });
  const angleResult = await supabase.from("Angle").select("*").eq("id", avatar.angleId).maybeSingle();
  const angle = angleResult.data as AngleRow | null;
  if (!angle) return Response.json({ error: "The selected avatar has no valid angle." }, { status: 400 });

  const now = new Date().toISOString();
  const [avatarMarket, avatarAllMarkets, angleMarket, factResult, offerResult, researchResult, playbookResult] = await Promise.all([
    supabase.from("Verbatim").select("id").eq("subAvatarId", avatar.id).like("researchId", "verified:%").ilike("market", marketCode),
    supabase.from("Verbatim").select("id").eq("subAvatarId", avatar.id).like("researchId", "verified:%"),
    supabase.from("Verbatim").select("id").eq("angleSlug", angle.slug).like("researchId", "verified:%").ilike("market", marketCode),
    supabase.from("BrandFact").select("id", { count: "exact", head: true }).eq("productId", productId).eq("status", "approved").or(`marketCode.is.null,marketCode.ilike.${marketCode}`),
    supabase.from("ProductOffer").select("*").eq("productId", productId).eq("status", "approved").or(`marketCode.is.null,marketCode.ilike.${marketCode}`).or(`validFrom.is.null,validFrom.lte.${now}`).or(`validUntil.is.null,validUntil.gte.${now}`),
    supabase.from("AvatarResearch").select("id", { count: "exact", head: true }).eq("subAvatarId", avatar.id),
    supabase.from("ScriptPlaybookVersion").select("id", { count: "exact", head: true }).eq("status", "published"),
  ]);

  const verbatimIds = new Set([
    ...(avatarMarket.data ?? []).map((row) => row.id),
    ...(avatarAllMarkets.data ?? []).map((row) => row.id),
    ...(angleMarket.data ?? []).map((row) => row.id),
  ]);
  const offers = (offerResult.data ?? []) as ProductOfferRow[];
  const selectedOfferValid = offerId ? offers.some((offer) => offer.id === offerId) : false;
  const facts = factResult.count ?? 0;
  const warnings: string[] = [];
  if (verbatimIds.size < 8) warnings.push(`Only ${verbatimIds.size} verified verbatims match; the playbook target is 8–12.`);
  if (facts === 0) warnings.push("No approved facts match this product and market; factual copy will stay non-specific.");
  if (funnelStage === "BOFU" && !selectedOfferValid) warnings.push("BOFU is selected without an applicable approved offer.");
  if (!referenceFormatId && !teardownRecordId) warnings.push("No reusable framework or teardown is selected; the standard structure will be used.");
  if ((researchResult.count ?? 0) === 0) warnings.push("This avatar has no structured research profile yet.");

  return Response.json({
    verbatims: { count: verbatimIds.size, targetMin: 8, targetMax: 12, ready: verbatimIds.size >= 8 },
    facts: { count: facts, ready: facts > 0 },
    offers: { count: offers.length, selectedValid: selectedOfferValid, required: funnelStage === "BOFU", ready: funnelStage !== "BOFU" || selectedOfferValid },
    avatarResearch: { ready: (researchResult.count ?? 0) > 0 },
    reference: { ready: Boolean(referenceFormatId || teardownRecordId) },
    playbook: { ready: (playbookResult.count ?? 0) > 0 },
    warnings,
  });
}
