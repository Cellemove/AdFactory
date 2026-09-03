import "server-only";

import { cosine, embedTexts } from "@/lib/cellumove/embeddings";
import {
  brollCandidateText,
  buildScriptBrollQuery,
  preselectScriptBrollCandidates,
  rankScriptBrollCandidates,
  SCRIPT_BROLL_RECENT_PROJECT_WINDOW,
  type ScriptBrollCandidate,
} from "@/lib/cellumove/script-broll";
import { ScriptDocumentSchema, type ScriptDocument } from "@/lib/cellumove/script-studio";
import type { BrollClipRow, ScriptProjectRow } from "@/lib/database.types";
import { supabase } from "@/lib/db";

const PAGE_SIZE = 1000;

async function listMatchingBrollClips(): Promise<BrollClipRow[]> {
  const rows: BrollClipRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await supabase
      .from("BrollClip")
      .select("*")
      .like("mimeType", "video/%")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (result.error) throw new Error(`Could not load the B-roll library: ${result.error.message}`);
    const page = (result.data ?? []) as BrollClipRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows.filter((clip) => {
    const hasIndexedContent = Boolean(clip.aiDescription?.trim() || clip.description?.trim() || clip.tags?.trim());
    return hasIndexedContent && !/trash/i.test(clip.folderPath ?? "");
  });
}

function recentSuggestionCounts(projects: ScriptProjectRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const project of projects) {
    const parsed = ScriptDocumentSchema.safeParse(project.document);
    if (!parsed.success) continue;
    const uniqueForProject = new Set(parsed.data.modules.flatMap((module) => module.brollRefs.map((ref) => ref.clipId)).filter((id): id is string => Boolean(id)));
    uniqueForProject.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  }
  return counts;
}

export interface ScriptBrollMatchingContext {
  clips: ScriptBrollCandidate[];
  recentSuggestionCounts: Map<string, number>;
}

export async function loadScriptBrollMatchingContext(): Promise<ScriptBrollMatchingContext> {
  const [rows, projectsResult] = await Promise.all([
    listMatchingBrollClips(),
    supabase.from("ScriptProject").select("*").order("createdAt", { ascending: false }).limit(SCRIPT_BROLL_RECENT_PROJECT_WINDOW),
  ]);
  if (projectsResult.error) throw new Error(`Could not load recent B-roll history: ${projectsResult.error.message}`);
  return {
    clips: rows.map((clip) => ({
      id: clip.id,
      name: clip.name,
      url: clip.webViewLink,
      folderPath: clip.folderPath,
      description: (clip.aiDescription || clip.description || "").trim(),
      tags: (clip.tags || "").trim(),
    })),
    recentSuggestionCounts: recentSuggestionCounts((projectsResult.data ?? []) as ScriptProjectRow[]),
  };
}

export async function matchBrollToScript(input: {
  document: ScriptDocument;
  idea: string;
  context: ScriptBrollMatchingContext;
}): Promise<{ document: ScriptDocument; mode: "hybrid" | "keyword"; candidateCount: number; matchedCount: number }> {
  const queries = input.document.modules.map((module) => buildScriptBrollQuery({ document: input.document, module, idea: input.idea }));
  const candidates = preselectScriptBrollCandidates({ queries, candidates: input.context.clips, perModule: 50 });
  const embeddings = await embedTexts([
    ...queries.map((query) => query.text),
    ...candidates.map(brollCandidateText),
  ]);
  const queryEmbeddings = embeddings?.slice(0, queries.length) ?? [];
  const candidateEmbeddings = embeddings?.slice(queries.length) ?? [];
  const hybridReady = Boolean(
    queries.length && candidates.length
    && queryEmbeddings.length === queries.length
    && candidateEmbeddings.length === candidates.length
    && candidateEmbeddings.every((embedding) => embedding.length > 0),
  );

  const excludedClipIds = new Set<string>();
  for (const beat of input.document.modules) {
    if (!beat.locked) continue;
    beat.brollRefs.forEach((ref) => { if (ref.clipId) excludedClipIds.add(ref.clipId); });
  }
  let matchedCount = 0;
  const modules = input.document.modules.map((beat, moduleIndex) => {
    if (beat.locked) return beat;
    const query = queries[moduleIndex]!;
    const semanticScores = hybridReady
      ? candidateEmbeddings.map((embedding) => cosine(queryEmbeddings[moduleIndex] ?? [], embedding))
      : undefined;
    const selected = rankScriptBrollCandidates({
      query,
      candidates,
      semanticScores,
      recentSuggestionCounts: input.context.recentSuggestionCounts,
      excludedClipIds,
    });
    selected.forEach((item) => excludedClipIds.add(item.clip.id));
    matchedCount += selected.length;
    return {
      ...beat,
      brollRefs: selected.map((item) => ({ clipId: item.clip.id, name: item.clip.name, url: item.clip.url })),
    };
  });
  return {
    document: ScriptDocumentSchema.parse({ ...input.document, modules }),
    mode: hybridReady ? "hybrid" : "keyword",
    candidateCount: candidates.length,
    matchedCount,
  };
}
