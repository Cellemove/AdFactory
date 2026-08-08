"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase, unwrap, unwrapOpt, newId } from "@/lib/db";
import type { GenerationRow, RunRow, BriefRow } from "@/lib/database.types";
import { buildIterationName, slugifyPart } from "@/lib/cellumove/naming";
import { EDITORS, LEVELS } from "@/lib/cellumove/constants";

type GenWithRunBrief = GenerationRow & { run: RunRow & { brief: BriefRow } };

const PromoteSchema = z.object({
  generationId: z.string().min(1),
  iterationNumber: z.coerce.number().int().min(1),
  level: z.enum(LEVELS),
  editor: z.enum(EDITORS),
  originalAdName: z.string().min(1),
  hookSlug: z.string().min(1).optional(),
  notes: z.string().optional().nullable(),
});

export async function promoteToIteration(input: z.infer<typeof PromoteSchema>) {
  const parsed = PromoteSchema.parse(input);

  const gen = unwrapOpt(
    await supabase
      .from("Generation")
      .select("*, run:Run(*, brief:Brief(*))")
      .eq("id", parsed.generationId)
      .maybeSingle(),
  ) as GenWithRunBrief | null;
  if (!gen) throw new Error("Generation not found");

  const hookSlug = parsed.hookSlug ?? slugifyPart(gen.hook);

  const iterationName = buildIterationName({
    iterationNumber: parsed.iterationNumber,
    level: parsed.level,
    editor: parsed.editor,
    originalAdName: parsed.originalAdName,
    hookSlug,
  });

  const created = unwrap(
    await supabase
      .from("Iteration")
      .insert({
        id: newId(),
        iterationName,
        parentWinnerId: gen.run.brief.parentWinnerId ?? null,
        runId: gen.runId,
        iterationNumber: parsed.iterationNumber,
        level: parsed.level,
        editor: parsed.editor,
        originalAdName: slugifyPart(parsed.originalAdName),
        hookSlug,
        notes: parsed.notes ?? null,
        createdAt: new Date().toISOString(),
      })
      .select("*")
      .single(),
  );

  const { error } = await supabase.from("Generation").update({ verdict: "approved" }).eq("id", gen.id);
  if (error) throw new Error(error.message);

  revalidatePath(`/runs/${gen.runId}`);
  return created;
}
