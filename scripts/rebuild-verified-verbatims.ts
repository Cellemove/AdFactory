import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { supabase, newId } from "../src/lib/db";
import { fetchYouTubeThreads } from "../src/lib/youtube";
import {
  buildVerifiedVerbatimQueries,
  normalizeVerbatimText,
  verifiedCandidatesFromYouTube,
  type VerifiedVerbatimCandidate,
} from "../src/lib/cellumove/verified-verbatims";
import type { AngleRow, VerbatimRow } from "../src/lib/database.types";

const TARGET = Math.max(50, Number(process.env.VERBATIM_TARGET || 500));
const PER_ANGLE = 70;
const PREFERRED_ANGLES = [
  "anti-cellulite",
  "lipoedema",
  "menopause",
  "pregnancy-swelling",
  "heavy-legs",
  "pots-postural-orthostatic-tachycardia-syndrome",
  "glp1-loose-skin",
  "glp1-body-aches",
  "glp1-body-recomposition",
  "all-day-chronic-comfort",
  "varicose-veins",
  "post-pregnancy",
];

function must<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${label}: no data returned`);
  return result.data;
}

async function main() {
  const [anglesResult, oldRowsResult] = await Promise.all([
    supabase.from("Angle").select("id,slug,name,mechanism,order").order("order", { ascending: true }),
    supabase.from("Verbatim").select("*").order("createdAt", { ascending: true }).limit(5000),
  ]);
  const allAngles = must(anglesResult, "load angles") as Array<Pick<AngleRow, "id" | "slug" | "name" | "mechanism" | "order">>;
  const oldRows = must(oldRowsResult, "load current corpus") as VerbatimRow[];
  const bySlug = new Map(allAngles.map((angle) => [angle.slug, angle]));
  const angles = PREFERRED_ANGLES.map((slug) => bySlug.get(slug)).filter(Boolean) as typeof allAngles;
  for (const angle of allAngles) {
    if (angles.length >= PREFERRED_ANGLES.length) break;
    if (!angles.some((candidate) => candidate.id === angle.id) && angle.slug !== "promo") angles.push(angle);
  }

  const collected: VerifiedVerbatimCandidate[] = [];
  const seen = new Set<string>();
  for (const angle of angles) {
    const threads = await fetchYouTubeThreads(
      buildVerifiedVerbatimQueries({ angleName: angle.name, mechanism: angle.mechanism }),
      { maxVideos: 12, maxComments: 50 },
    );
    const candidates = verifiedCandidatesFromYouTube({ threads, angleSlug: angle.slug })
      .sort((a, b) => b.sourceWeight - a.sourceWeight);
    let kept = 0;
    for (const candidate of candidates) {
      const key = normalizeVerbatimText(candidate.text);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(candidate);
      kept++;
      if (kept >= PER_ANGLE) break;
    }
    console.log(`${angle.slug}: ${kept} verified comments (${collected.length}/${TARGET})`);
    if (collected.length >= TARGET) break;
  }

  if (collected.length < TARGET) {
    throw new Error(`Collected only ${collected.length}/${TARGET} verified comments. Existing corpus was not changed.`);
  }

  const backupDir = path.join(process.cwd(), "backups");
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `verbatims-before-verified-rebuild-${stamp}.json`);
  await writeFile(backupPath, JSON.stringify({ exportedAt: new Date().toISOString(), count: oldRows.length, rows: oldRows }, null, 2), "utf8");

  const now = new Date().toISOString();
  const rows = collected.slice(0, TARGET).map(({ sourceAuthor, sourcePublishedAt, sourceFingerprint, ...candidate }) => ({
    ...candidate,
    id: newId(),
    createdAt: now,
    // Preserve API provenance without a schema migration. The exact author,
    // publish time and source fingerprint are recoverable from the deep link/API.
    // They are intentionally not placed in the quote text.
    researchId: candidate.researchId,
    _audit: { sourceAuthor, sourcePublishedAt, sourceFingerprint },
  }));
  const insertRows = rows.map(({ _audit: _audit, ...row }) => row);
  for (let index = 0; index < insertRows.length; index += 100) {
    const result = await supabase.from("Verbatim").insert(insertRows.slice(index, index + 100));
    if (result.error) throw new Error(`insert verified rows ${index}-${index + 99}: ${result.error.message}`);
  }

  const verifiedCountResult = await supabase
    .from("Verbatim")
    .select("id", { head: true, count: "exact" })
    .like("researchId", "verified:%");
  if (verifiedCountResult.error || (verifiedCountResult.count ?? 0) < TARGET) {
    throw new Error(`Verified insert audit failed: ${verifiedCountResult.error?.message ?? `${verifiedCountResult.count} rows`}. Old corpus was retained.`);
  }

  // Delete only the exact rows captured in the backup. If this step fails, the
  // old rows remain quarantined because every app query requires verified:*.
  for (let index = 0; index < oldRows.length; index += 100) {
    const ids = oldRows.slice(index, index + 100).map((row) => row.id);
    const result = await supabase.from("Verbatim").delete().in("id", ids);
    if (result.error) throw new Error(`remove quarantined rows ${index}-${index + 99}: ${result.error.message}`);
  }

  const auditPath = path.join(backupDir, `verified-verbatims-audit-${stamp}.json`);
  await writeFile(auditPath, JSON.stringify({ generatedAt: now, count: rows.length, rows }, null, 2), "utf8");
  console.log(JSON.stringify({ verified: rows.length, removed: oldRows.length, backupPath, auditPath }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
