"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase, unwrap, newId } from "@/lib/db";

const SwipeSchema = z.object({
  title: z.string().min(1),
  brand: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  imagePath: z.string().optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
  tags: z.string().optional().nullable(),
});

export async function createSwipeFile(input: z.infer<typeof SwipeSchema>) {
  const parsed = SwipeSchema.parse(input);
  const created = unwrap(
    await supabase
      .from("SwipeFile")
      .insert({
        id: newId(),
        title: parsed.title,
        brand: parsed.brand ?? null,
        category: parsed.category ?? null,
        notes: parsed.notes ?? null,
        imagePath: parsed.imagePath ?? null,
        sourceUrl: parsed.sourceUrl ?? null,
        tags: parsed.tags ?? null,
        createdAt: new Date().toISOString(),
      })
      .select("*")
      .single(),
  );
  revalidatePath("/swipe-file");
  return created;
}

export async function deleteSwipeFile(id: string) {
  const { error } = await supabase.from("SwipeFile").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/swipe-file");
}

const NoteSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  body: z.string().min(1),
  pinned: z.boolean().optional(),
  tags: z.string().optional().nullable(),
});

export async function upsertKnowledgeNote(input: z.infer<typeof NoteSchema>) {
  const parsed = NoteSchema.parse(input);
  const now = new Date().toISOString();
  const saved = parsed.id
    ? unwrap(
        await supabase
          .from("KnowledgeNote")
          .update({
            title: parsed.title,
            body: parsed.body,
            pinned: parsed.pinned ?? false,
            tags: parsed.tags ?? null,
            updatedAt: now,
          })
          .eq("id", parsed.id)
          .select("*")
          .single(),
      )
    : unwrap(
        await supabase
          .from("KnowledgeNote")
          .insert({
            id: newId(),
            title: parsed.title,
            body: parsed.body,
            pinned: parsed.pinned ?? false,
            tags: parsed.tags ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .select("*")
          .single(),
      );
  revalidatePath("/knowledge");
  return saved;
}

export async function deleteKnowledgeNote(id: string) {
  const { error } = await supabase.from("KnowledgeNote").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/knowledge");
}
