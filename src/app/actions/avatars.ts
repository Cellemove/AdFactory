"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase, unwrap, unwrapOpt, newId } from "@/lib/db";
import { slugifyPart } from "@/lib/cellumove/naming";

const CreateSubAvatarSchema = z.object({
  angleSlug: z.string().min(1),
  name: z.string().min(2).max(80),
  shortDesc: z.string().max(280).optional().nullable(),
});

export async function createSubAvatar(input: z.infer<typeof CreateSubAvatarSchema>) {
  const parsed = CreateSubAvatarSchema.parse(input);
  const angleRes = await supabase.from("Angle").select("*").eq("slug", parsed.angleSlug).maybeSingle();
  const angle = unwrapOpt(angleRes) as { id: string } | null;
  if (!angle) throw new Error(`Unknown angle: ${parsed.angleSlug}`);

  const baseSlug = `${parsed.angleSlug}-${slugifyPart(parsed.name)}`;
  let slug = baseSlug;
  let n = 2;
  while (
    unwrapOpt(await supabase.from("SubAvatar").select("id").eq("slug", slug).maybeSingle())
  ) {
    slug = `${baseSlug}-${n++}`;
  }
  const now = new Date().toISOString();
  const res = await supabase
    .from("SubAvatar")
    .insert({
      id: newId(),
      angleId: angle.id,
      slug,
      name: parsed.name,
      shortDesc: parsed.shortDesc ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .select("*")
    .single();
  const created = unwrap(res);
  revalidatePath("/avatars");
  revalidatePath("/scripts/new");
  return created;
}

const ResearchSchema = z.object({
  subAvatarId: z.string().min(1),
  painPoints: z.string().min(1),
  desires: z.string().min(1),
  objections: z.string().min(1),
  dailyLanguage: z.string().min(1),
  triggers: z.string().min(1),
  identity: z.string().min(1),
  socialProof: z.string().min(1),
  buyingContext: z.string().min(1),
  notes: z.string().optional().nullable(),
});

export async function upsertResearch(input: z.infer<typeof ResearchSchema>) {
  const parsed = ResearchSchema.parse(input);
  // Look up by subAvatarId so we can upsert by primary key (id) or insert fresh.
  const existing = unwrapOpt(
    await supabase.from("AvatarResearch").select("id").eq("subAvatarId", parsed.subAvatarId).maybeSingle(),
  ) as { id: string } | null;
  const now = new Date().toISOString();
  const row = {
    id: existing?.id ?? newId(),
    subAvatarId: parsed.subAvatarId,
    painPoints: parsed.painPoints,
    desires: parsed.desires,
    objections: parsed.objections,
    dailyLanguage: parsed.dailyLanguage,
    triggers: parsed.triggers,
    identity: parsed.identity,
    socialProof: parsed.socialProof,
    buyingContext: parsed.buyingContext,
    notes: parsed.notes ?? null,
    updatedAt: now,
    createdAt: existing ? undefined : now,
  };
  const saved = unwrap(await supabase.from("AvatarResearch").upsert(row).select("*").single());
  revalidatePath("/avatars");
  return saved;
}

export async function deleteSubAvatar(id: string) {
  // AvatarResearch has ON DELETE CASCADE via the FK Prisma created.
  const { error } = await supabase.from("SubAvatar").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/avatars");
}
