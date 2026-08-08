"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase, unwrap, unwrapOpt, newId } from "@/lib/db";

const CreateAngleSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().optional(),
  requiredKeyword: z.string().min(1).max(80),
  mechanism: z.string().min(2).max(280),
  bannedMechanism: z.string().optional(),
  silhouette: z.enum(["short-legging", "full-length"]).optional(),
  colorway: z.enum(["pink", "black"]).optional(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export async function createAngle(input: z.infer<typeof CreateAngleSchema>) {
  const parsed = CreateAngleSchema.parse(input);

  const baseSlug = parsed.slug?.trim() || slugify(parsed.name);
  if (!baseSlug) throw new Error("Could not derive a slug from the name.");
  let slug = baseSlug;
  let n = 2;
  while (
    unwrapOpt(await supabase.from("Angle").select("id").eq("slug", slug).maybeSingle())
  ) {
    slug = `${baseSlug}-${n++}`;
  }

  // Order = max existing + 1 so the new angle appears at the end.
  const lastRes = await supabase
    .from("Angle")
    .select("order")
    .order("order", { ascending: false })
    .limit(1);
  const lastOrder = (lastRes.data?.[0]?.order as number | undefined) ?? 0;

  const created = unwrap(
    await supabase
      .from("Angle")
      .insert({
        id: newId(),
        slug,
        name: parsed.name,
        requiredKeyword: parsed.requiredKeyword,
        mechanism: parsed.mechanism,
        bannedMechanism: parsed.bannedMechanism ?? "",
        silhouette: parsed.silhouette ?? "short-legging",
        colorway: parsed.colorway ?? "pink",
        order: lastOrder + 1,
        createdAt: new Date().toISOString(),
      })
      .select("*")
      .single(),
  );
  revalidatePath("/avatars");
  revalidatePath("/new");
  revalidatePath("/winners");
  return created;
}

export async function deleteAngle(id: string) {
  // SubAvatars, WinningAds, Briefs, Runs reference angleId. Server will fail the
  // delete if dependent rows exist (FK constraint).
  const { error } = await supabase.from("Angle").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/avatars");
}
