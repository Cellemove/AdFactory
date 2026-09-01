import { supabase } from "@/lib/db";
import type { Json, ResearchEvidenceRow } from "@/lib/database.types";
import { EMBED_MODEL, embedTexts } from "./embeddings";
import {
  canonicalizeResearchUrl,
  deterministicResearchId,
  normalizeEvidenceText,
  reciprocalRankFusion,
  type ResearchEvidenceClaim,
  type ResearchQualityReport,
  type ResearchQueryPlan,
  type ResearchType,
} from "./research-evidence";
import type { DraftVerification } from "./verify-research";

export interface LedgerDraft {
  draftKey: string;
  evidence: ResearchEvidenceClaim[];
  verification: DraftVerification | null;
  quality: ResearchQualityReport;
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number.isFinite(value) ? value.toFixed(8) : "0").join(",")}]`;
}

function isMissingArchitecture(message: string): boolean {
  return /Research(Source|Evidence|Feedback)|queryPlan|qualityScore|qualityStatus|qualityReport/i.test(message)
    && /does not exist|schema cache|column/i.test(message);
}

export async function persistResearchLedger(input: {
  researchId: string;
  type: ResearchType;
  queryPlan: ResearchQueryPlan;
  drafts: LedgerDraft[];
}): Promise<boolean> {
  try {
    const sourceRows = new Map<string, {
      id: string;
      researchId: string;
      canonicalUrl: string;
      domain: string;
      sourceType: string;
      status: string;
      httpStatus: number;
      excerpt: string | null;
      contentHash: string | null;
      metadata: Json;
    }>();

    for (const draft of input.drafts) {
      for (const source of draft.verification?.sources ?? []) {
        const canonicalUrl = source.canonicalUrl ?? canonicalizeResearchUrl(source.url);
        if (!canonicalUrl) continue;
        sourceRows.set(canonicalUrl, {
          id: deterministicResearchId("research-source", input.researchId, canonicalUrl),
          researchId: input.researchId,
          canonicalUrl,
          domain: source.domain,
          sourceType: source.sourceType,
          status: source.ok ? "live" : "blocked_or_dead",
          httpStatus: source.status,
          excerpt: source.excerpt || null,
          contentHash: source.contentHash,
          metadata: { checkedAt: draft.verification?.checkedAt ?? null },
        });
      }
    }

    if (sourceRows.size > 0) {
      const result = await supabase.from("ResearchSource").upsert([...sourceRows.values()], { onConflict: "researchId,canonicalUrl" });
      if (result.error) throw new Error(result.error.message);
    }

    const flattened = input.drafts.flatMap((draft) =>
      draft.evidence.map((item) => ({ draft, item })),
    );
    const embeddings = flattened.length > 0 ? await embedTexts(flattened.map(({ item }) => item.text)) : [];
    const evidenceRows = flattened.map(({ draft, item }, index) => {
      const normalizedText = normalizeEvidenceText(item.text);
      const sourceUrl = item.sourceUrl ? canonicalizeResearchUrl(item.sourceUrl) : null;
      const contentHash = deterministicResearchId(item.type, normalizedText, sourceUrl);
      const source = sourceUrl ? sourceRows.get(sourceUrl) : null;
      return {
        id: deterministicResearchId("research-evidence", input.researchId, draft.draftKey, contentHash),
        researchId: input.researchId,
        sourceId: source?.id ?? null,
        draftKey: draft.draftKey,
        category: item.category,
        evidenceType: item.type,
        text: item.text,
        normalizedText,
        sourceUrl,
        verificationStatus: item.verificationStatus ?? (item.type === "inference" ? "inference" : "unverified"),
        confidence: item.verificationStatus === "verified" ? 1 : item.verificationStatus === "source_checked" ? 0.65 : item.type === "inference" ? 0.35 : 0,
        contentHash,
        embedding: embeddings?.[index]?.length === 768 ? vectorLiteral(embeddings[index]!) : null,
        embeddingModel: embeddings?.[index]?.length === 768 ? EMBED_MODEL : null,
        embeddingVersion: "v1",
        metadata: { researchType: input.type, qualityStatus: draft.quality.status },
      };
    });
    if (evidenceRows.length > 0) {
      const result = await supabase.from("ResearchEvidence").upsert(evidenceRows, { onConflict: "researchId,draftKey,contentHash" });
      if (result.error) throw new Error(result.error.message);
    }

    const qualityScore = input.drafts.length
      ? Math.round(input.drafts.reduce((sum, draft) => sum + draft.quality.score, 0) / input.drafts.length)
      : 0;
    const statusOrder = { pass: 0, review: 1, reject: 2 } as const;
    const qualityStatus = input.drafts.reduce<ResearchQualityReport["status"]>(
      (worst, draft) => statusOrder[draft.quality.status] > statusOrder[worst] ? draft.quality.status : worst,
      "pass",
    );
    const update = await supabase.from("Research").update({
      queryPlan: input.queryPlan as unknown as Json,
      qualityScore,
      qualityStatus,
      qualityReport: { drafts: input.drafts.map((draft) => ({ draftKey: draft.draftKey, ...draft.quality })) } as Json,
    }).eq("id", input.researchId);
    if (update.error) throw new Error(update.error.message);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isMissingArchitecture(message)) {
      console.warn("[research-ledger] Migration 011 has not been applied; research JSON still contains evidence and quality data.");
    } else {
      console.warn("[research-ledger] Persistence failed:", message);
    }
    return false;
  }
}

export interface RetrievedResearchEvidence {
  id: string;
  text: string;
  category: string;
  sourceUrl: string | null;
  verificationStatus: string;
  score: number;
}

export async function retrieveResearchEvidence(input: {
  query: string;
  angleSlug?: string | null;
  category?: string | null;
  topK?: number;
}): Promise<RetrievedResearchEvidence[]> {
  const topK = Math.max(1, Math.min(input.topK ?? 8, 20));
  try {
    let keywordQuery = supabase
      .from("ResearchEvidence")
      .select("id,researchId,draftKey,category,text,sourceUrl,verificationStatus")
      .textSearch("text", input.query, { type: "websearch", config: "english" })
      .in("verificationStatus", ["verified", "source_checked"])
      .limit(30);
    if (input.category) keywordQuery = keywordQuery.eq("category", input.category);
    const keyword = await keywordQuery;
    if (keyword.error) throw new Error(keyword.error.message);

    const queryEmbedding = await embedTexts([input.query]);
    let denseRows: Array<Pick<ResearchEvidenceRow, "id" | "researchId" | "draftKey" | "category" | "text" | "sourceUrl" | "verificationStatus"> & { similarity: number }> = [];
    if (queryEmbedding?.[0]?.length) {
      const dense = await supabase.rpc("match_research_evidence", {
        query_embedding: vectorLiteral(queryEmbedding[0]),
        match_count: 30,
        filter_angle_slug: input.angleSlug ?? null,
        filter_category: input.category ?? null,
      });
      if (!dense.error) denseRows = dense.data ?? [];
    }

    const keywordRows = keyword.data ?? [];
    const byId = new Map<string, RetrievedResearchEvidence>();
    for (const row of [...keywordRows, ...denseRows]) {
      byId.set(row.id, {
        id: row.id,
        text: row.text,
        category: row.category,
        sourceUrl: row.sourceUrl,
        verificationStatus: row.verificationStatus,
        score: 0,
      });
    }
    const fused = reciprocalRankFusion(
      [denseRows.map((row) => row.id), keywordRows.map((row) => row.id)],
      [0.6, 0.4],
    );
    return fused.slice(0, topK).map(({ id, score }) => ({ ...byId.get(id)!, score }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isMissingArchitecture(message)) console.warn("[research-retrieval] Retrieval failed:", message);
    return [];
  }
}

export function renderRetrievedResearchEvidence(items: RetrievedResearchEvidence[]): string {
  if (items.length === 0) return "";
  return [
    "REUSABLE VERIFIED EVIDENCE — retrieved from prior AdFactory research:",
    ...items.map((item, index) => `[E${index + 1}] [${item.category}] ${item.text}${item.sourceUrl ? ` — ${item.sourceUrl}` : ""}`),
    "Treat these as supporting context. Run fresh collection too; do not copy a prior conclusion blindly.",
  ].join("\n");
}
