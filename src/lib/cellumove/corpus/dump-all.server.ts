import "server-only";
import { dumpAdJson } from "./dump.server";
import { sortDeconstructedAds } from "./dump-usable";
import { loadAdTeardowns } from "./teardown.server";
import { createZip, type ZipEntry } from "@/lib/zip";

const LANES = 8; // ~6 small queries per ad, 8 ads at a time: about 10s per 100 ads

export type DeconstructedAdsZip = { zip: Buffer; ads: number; unique: number; recuts: number; otherProducts: number };

/**
 * Every deconstructed ad as one ZIP: a JSON file per ad (the same document as the
 * single-ad download — transcript, beats and the full Teardown workbook), plus an
 * index.json. Ads are filed by usefulness: unique/ (one per distinct script),
 * recuts/ (same script as a better-scoring ad) and other-products/.
 */
export async function buildDeconstructedAdsZip(): Promise<DeconstructedAdsZip | null> {
  const teardowns = (await loadAdTeardowns()).filter((row) => row.status === "completed");
  if (!teardowns.length) return null;

  const dumps: Array<Record<string, unknown> | null> = new Array(teardowns.length).fill(null);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(LANES, teardowns.length) }, async () => {
    while (cursor < teardowns.length) {
      const index = cursor++;
      dumps[index] = await dumpAdJson(teardowns[index]!.competitorAdId, teardowns[index]);
    }
  }));

  type DumpAd = { id: string; brandName: string; winnerScore: number | null; formatTag: string | null; angleTag: string | null };
  type Workbook = { fields?: Array<{ key: string; value: unknown }>; scenes?: Array<{ audio?: unknown }> };
  // the ad row was deleted after it was deconstructed → no dump
  const found = dumps.filter((dump): dump is Record<string, unknown> => dump !== null).map((dump) => {
    const workbook = ((dump.teardown as { workbook?: Workbook } | null)?.workbook ?? {}) as Workbook;
    const field = (key: string) => String(workbook.fields?.find((item) => item.key === `basic_ad_information.${key}`)?.value ?? "");
    return { dump, ad: dump.ad as DumpAd, product: field("ad_name_product"), category: field("product_category"), spoken: (workbook.scenes ?? []).map((scene) => String(scene.audio ?? "")).join(" ") };
  });
  const verdicts = sortDeconstructedAds(found.map((item) => ({ id: item.ad.id, winnerScore: item.ad.winnerScore, product: `${item.product} ${item.category}`, spoken: item.spoken })));

  const safe = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, "_") || "unknown";
  const entries: ZipEntry[] = [];
  const index: Array<Record<string, unknown>> = [];
  for (const { dump, ad, product } of found) {
    const verdict = verdicts.get(ad.id)!;
    const path = `${verdict.folder}/${safe(ad.brandName)}/${safe(ad.id)}.json`;
    entries.push({ path, content: JSON.stringify(dump, null, 2) });
    index.push({ file: path, id: ad.id, brand: ad.brandName, product, winnerScore: ad.winnerScore, format: ad.formatTag, concept: ad.angleTag, beats: (dump.beats as unknown[]).length, spokenWords: verdict.spokenWords, duplicateOf: verdict.duplicateOf });
  }
  index.sort((a, b) => Number(b.winnerScore ?? 0) - Number(a.winnerScore ?? 0));
  const count = (folder: string) => index.filter((row) => String(row.file).startsWith(`${folder}/`)).length;
  const totals = { ads: index.length, unique: count("unique"), recuts: count("recuts"), otherProducts: count("other-products") };
  entries.unshift({ path: "index.json", content: JSON.stringify({ exportedAt: new Date().toISOString(), ...totals, files: index }, null, 2) });
  return { zip: createZip(entries), ...totals };
}
