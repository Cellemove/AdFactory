// TEARDOWN — send the corpus winners to the Teardown service and mirror its
// 14-part workbook locally. Pure pieces only: which ads count as winners, which
// copy of the video Teardown should read, and how its job record maps onto an
// "AdTeardown" row. The workbook is a qualitative read for humans; it is open
// vocabulary with no evidence gate, so nothing here feeds MINE.

import { createHash } from "node:crypto";
import { z } from "zod";
import { ParsedTeardownWorkbookSchema } from "@/lib/cellumove/teardown-brief";
import type { AdMediaRow, AdTeardownRow, CorpusAdStateRow } from "@/lib/database.types";
import { isMediaLinkExpired, pickMediaSource, type AdLike } from "./media";

export const TEARDOWN_STATUSES = ["queued", "processing", "completed", "failed"] as const;
export type TeardownStatus = (typeof TEARDOWN_STATUSES)[number];

/** Gemini 2.5 Pro list price, the same figures Teardown's own usage page uses. */
const INPUT_USD_PER_M = 1.25;
const OUTPUT_USD_PER_M = 10;
/** Observed per-video average on the live service, for dry-run estimates only. */
export const TEARDOWN_TYPICAL_COST_USD = 0.2;

export function teardownRowId(competitorAdId: string): string {
  return `atd_${createHash("sha256").update(competitorAdId).digest("hex").slice(0, 24)}`;
}

export function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed";
}

/** The spec's winner cut: top quartile by winnerScore. */
export function defaultWinnerCount(scored: number): number {
  return Math.max(1, Math.ceil(scored / 4));
}

/**
 * Corpus ads to tear down, best first: included videos with a winnerScore.
 * Unscored ads are never "winners" — run miner:score first.
 */
export function pickWinners(rows: CorpusAdStateRow[], count: number): CorpusAdStateRow[] {
  return rows
    .filter((row) => row.mediaType === "video" && row.corpusIncluded && row.winnerScore != null)
    .sort((a, b) => (b.winnerScore ?? 0) - (a.winnerScore ?? 0))
    .slice(0, count);
}

export type TeardownSource =
  | { kind: "url"; url: string; sourceKind: "video_sd_url" | "video_hd_url" | "videoUrl" }
  | { kind: "stored"; mime: string; bytes: number; sha256: string };

/**
 * A live provider link is cheapest (Teardown fetches it itself). Once it has
 * expired, fall back to the stored copy from MEDIA.
 */
export function teardownSourceFor(
  ad: AdLike & { mediaExpiresAt: string | null },
  media: Pick<AdMediaRow, "status" | "storagePath" | "localPath" | "mime" | "bytes" | "sha256"> | null,
  now: number = Date.now(),
): TeardownSource | null {
  const link = pickMediaSource(ad);
  if (link && !isMediaLinkExpired(ad, now)) return { kind: "url", url: link.url, sourceKind: link.kind };
  if (media?.status === "downloaded" && (media.storagePath || media.localPath) && media.mime && media.bytes && media.sha256) {
    return { kind: "stored", mime: media.mime, bytes: media.bytes, sha256: media.sha256 };
  }
  return null;
}

/** Teardown's public job record — only the fields the mirror keeps. */
export const TeardownJobSchema = z.object({
  id: z.string(),
  status: z.enum(TEARDOWN_STATUSES),
  sha256: z.string().nullable().optional(),
  parsed_output: ParsedTeardownWorkbookSchema.nullable().optional(),
  raw_output: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  sheet_row_link: z.string().nullable().optional(),
  prompt_tokens: z.number().int().nullable().optional(),
  output_tokens: z.number().int().nullable().optional(),
  completed_at: z.string().nullable().optional(),
});
export type TeardownJob = z.infer<typeof TeardownJobSchema>;

export function jobToRowPatch(job: TeardownJob): Partial<AdTeardownRow> & Pick<AdTeardownRow, "teardownId" | "status"> {
  return {
    teardownId: job.id,
    status: job.status,
    workbook: job.parsed_output ?? null,
    rawOutput: job.raw_output ?? null,
    sheetRowLink: job.sheet_row_link ?? null,
    promptTokens: job.prompt_tokens ?? null,
    outputTokens: job.output_tokens ?? null,
    errorCode: job.status === "failed" ? job.error_code ?? "failed" : null,
    errorMessage: job.status === "failed" ? job.error_message ?? null : null,
    completedAt: job.completed_at ?? null,
  };
}

export function teardownCostUsd(row: Pick<AdTeardownRow, "promptTokens" | "outputTokens">): number | null {
  if (row.promptTokens == null || row.outputTokens == null) return null;
  return (row.promptTokens / 1_000_000) * INPUT_USD_PER_M + (row.outputTokens / 1_000_000) * OUTPUT_USD_PER_M;
}

/** Teardown caps ad_name at 160 characters. */
export function teardownAdName(ad: { brandName: string; externalId: string }): string {
  return `${ad.brandName} · ${ad.externalId}`.slice(0, 160);
}

/** The workbook's headline answers, found by label so field order can drift. */
export function workbookHeadlines(workbook: unknown): Array<{ label: string; value: string }> {
  const parsed = ParsedTeardownWorkbookSchema.safeParse(workbook);
  if (!parsed.success) return [];
  const wanted = [
    /^the one thing that makes this work$/i,
    /^market awareness stage$/i,
    /^primary pain point$/i,
    /^what makes this different$/i,
    /^most powerful proof element$/i,
    /^structure pattern$/i,
  ];
  const out: Array<{ label: string; value: string }> = [];
  for (const pattern of wanted) {
    // A value still wrapped in [brackets] is the template's placeholder echoed back.
    const field = parsed.data.fields.find((item) => pattern.test(item.label.trim()) && item.value.trim() && !item.value.trim().startsWith("["));
    if (field) out.push({ label: field.label.trim(), value: field.value.trim() });
  }
  return out;
}
