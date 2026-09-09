// Analyze the "Intelligence Industrielle" Drive: for each competitor brand folder,
// feed its research PDF(s) + a sample of its ad-creative screenshots to Gemini and
// distill ONE compact intel brief (angles, hooks, claims, offers, creative style).
// Persisted as a single Research doc (type "competitor_intel" — no migration
// needed); /spy folds the briefs into its prompt so sweeps search these brands'
// actual playbooks, not blind categories.
//
// Re-runnable: a brand is skipped when its folder's file set is unchanged since
// the last analysis (pass --force to redo everything). Saves after every brand,
// so an interrupted run keeps its progress.
//
// Run: npm run analyze:intel          (all pending brands)
//      npm run analyze:intel -- --force

import { createHash } from "node:crypto";
import { getLLM, FAST_MODEL } from "../src/lib/llm";
import { recordUsage } from "../src/lib/usage";
import { listIntelBrandFolders, downloadDriveFile, type IntelBrandFolder, type IntelFile } from "../src/lib/drive";
import { loadIntelBriefDoc, saveIntelBriefDoc, type IntelBriefDoc } from "../src/lib/cellumove/intel-briefs";

const CONCURRENCY = 3;
const MAX_PDFS = 2;
const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_BYTES = 100 * 1024;
const MAX_PAYLOAD_BYTES = 18 * 1024 * 1024; // inline request ceiling, keep headroom

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/csv"]);

function filesHash(files: IntelFile[]): string {
  const h = createHash("sha1");
  h.update(files.map((f) => `${f.id}:${f.name}`).sort().join("|"));
  return h.digest("hex");
}

// Evenly sample n items so we cover File_1.x, File_2.x, File_3.x groups, not just
// the first ad's frames.
function sample<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const step = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)]).filter((x): x is T => x !== undefined);
}

function buildPrompt(folderName: string): string {
  return [
    "You are building competitor advertising intelligence for CelluMove, a DTC compression/shaping leggings brand.",
    `Attached are ad-creative screenshots and/or a research PDF for ONE competitor brand or ad page (drive folder: "${folderName}").`,
    "Write a compact intel brief in PLAIN TEXT, ≤250 words, exactly these labeled lines:",
    "BRAND: the real brand/page name, its product(s) and positioning",
    "ANGLES & HOOKS: the ad angles and hook lines used in the creatives — QUOTE real hook text where visible",
    "CLAIMS & OFFERS: claims, prices, discounts, bundles, guarantees seen",
    "CREATIVE STYLE: formats (UGC, testimonial, demo, doctor/authority...), recurring visual patterns, platforms if identifiable",
    "LINKS: any URLs, handles or ad-library links visible (else 'none seen')",
    "No preamble, no markdown, nothing outside those five lines.",
  ].join("\n");
}

interface AnalyzableAssets {
  parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }>;
  used: string[];
}

async function gatherAssets(folder: IntelBrandFolder): Promise<AnalyzableAssets> {
  const parts: AnalyzableAssets["parts"] = [];
  const used: string[] = [];
  let payload = 0;

  const take = async (f: IntelFile, asText: boolean) => {
    if (payload + (f.sizeBytes ?? 0) > MAX_PAYLOAD_BYTES) return;
    const bytes = await downloadDriveFile(f.id);
    payload += bytes.length;
    if (asText) {
      parts.push({ text: `--- ${f.name} ---\n${bytes.toString("utf8").slice(0, 15000)}` });
    } else {
      parts.push({ inlineData: { mimeType: f.mimeType, data: bytes.toString("base64") } });
    }
    used.push(f.name);
  };

  const texts = folder.files.filter((f) => TEXT_MIMES.has(f.mimeType) && (f.sizeBytes ?? 0) <= MAX_TEXT_BYTES);
  const pdfs = folder.files
    .filter((f) => f.mimeType === "application/pdf" && (f.sizeBytes ?? Infinity) <= MAX_PDF_BYTES)
    .sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0))
    .slice(0, MAX_PDFS);
  const images = sample(
    folder.files
      .filter((f) => IMAGE_MIMES.has(f.mimeType) && (f.sizeBytes ?? Infinity) <= MAX_IMAGE_BYTES)
      .sort((a, b) => a.name.localeCompare(b.name)),
    MAX_IMAGES,
  );

  for (const f of texts) await take(f, true);
  for (const f of pdfs) await take(f, false);
  for (const f of images) await take(f, false);
  return { parts, used };
}

async function analyzeBrand(folder: IntelBrandFolder): Promise<string | null> {
  const { parts, used } = await gatherAssets(folder);
  if (!parts.length) return null;

  const llm = getLLM();
  const resp = await llm.models.generateContent({
    model: FAST_MODEL,
    contents: [{ role: "user", parts: [...parts, { text: buildPrompt(folder.name) }] }],
    config: { maxOutputTokens: 4096, temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } },
  });
  await recordUsage({
    feature: "intel_brand_analysis",
    model: FAST_MODEL,
    usage: resp.usageMetadata,
    metadata: { folder: folder.name, files: used.length },
  });
  const summary = resp.text?.trim();
  if (!summary) throw new Error("Gemini returned no text.");
  return summary;
}

function cleanBrand(folderName: string): string {
  return folderName.replace(/\s*\(\d+\)\s*$/, "").replace(/\s*-\s*\d*\s*$/, "").trim() || folderName;
}

async function main() {
  const force = process.argv.includes("--force");
  console.log("Listing brand folders in the intelligence drive…");
  const folders = await listIntelBrandFolders();
  console.log(`${folders.length} brand folder(s) found.\n`);

  const existing = await loadIntelBriefDoc();
  let rowId: string | null = existing?.id ?? null;
  const doc: IntelBriefDoc = existing?.doc ?? { brands: {} };

  const pending = folders.filter((f) => force || doc.brands[f.id]?.filesHash !== filesHash(f.files));
  console.log(`${folders.length - pending.length} up to date · analyzing ${pending.length} · ${CONCURRENCY} lanes\n`);

  // All saves funnel through one chain: no concurrent-lane clobbering, and the
  // first save creates the row exactly once.
  let saveChain: Promise<void> = Promise.resolve();
  const save = () => {
    saveChain = saveChain.then(async () => {
      rowId = await saveIntelBriefDoc(rowId, doc);
    });
    return saveChain;
  };

  let ok = 0;
  let empty = 0;
  let failed = 0;
  let i = 0;
  const lane = async () => {
    while (i < pending.length) {
      const folder = pending[i++];
      if (!folder) break;
      try {
        const summary = await analyzeBrand(folder);
        if (!summary) {
          empty++;
          console.log(`—  ${folder.name} (no analyzable files)`);
          continue;
        }
        doc.brands[folder.id] = {
          brand: cleanBrand(folder.name),
          folderPath: folder.name,
          summary,
          filesHash: filesHash(folder.files),
          fileCount: folder.files.length,
          analyzedAt: new Date().toISOString(),
        };
        await save();
        ok++;
        console.log(`✓  ${folder.name} — ${summary.split("\n")[0]?.slice(0, 90) ?? ""}`);
      } catch (e) {
        failed++;
        console.error(`✗  ${folder.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, lane));
  await saveChain;

  console.log(`\nDone — ${ok} analyzed, ${empty} without analyzable files, ${failed} failed · ${Object.keys(doc.brands).length} briefs stored.`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
