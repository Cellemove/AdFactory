"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase, unwrap, unwrapOpt, newId } from "@/lib/db";

const Funnel = z.enum(["TOFU", "MOFU", "BOFU"]);

const CreateBigSwingSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().optional(),
  funnel: Funnel,
  description: z.string().min(2).max(400),
  visualSpec: z.string().min(2).max(1000),
  headlineOptions: z.array(z.string().min(1)).max(20),
  hookMechanic: z.string().optional().nullable(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export async function createBigSwing(input: z.infer<typeof CreateBigSwingSchema>) {
  const parsed = CreateBigSwingSchema.parse(input);

  const baseSlug = parsed.slug?.trim() || slugify(parsed.name);
  if (!baseSlug) throw new Error("Could not derive a slug from the name.");
  let slug = baseSlug;
  let n = 2;
  while (
    unwrapOpt(await supabase.from("BigSwing").select("id").eq("slug", slug).maybeSingle())
  ) {
    slug = `${baseSlug}-${n++}`;
  }

  const lastRes = await supabase
    .from("BigSwing")
    .select("order")
    .order("order", { ascending: false })
    .limit(1);
  const lastOrder = (lastRes.data?.[0]?.order as number | undefined) ?? 0;

  const created = unwrap(
    await supabase
      .from("BigSwing")
      .insert({
        id: newId(),
        slug,
        name: parsed.name,
        // `format` mirrors `slug` — same convention as the seed.
        format: slug,
        funnel: parsed.funnel,
        description: parsed.description,
        visualSpec: parsed.visualSpec,
        headlineOptions: JSON.stringify(parsed.headlineOptions),
        hookMechanic: parsed.hookMechanic ?? null,
        order: lastOrder + 1,
        createdAt: new Date().toISOString(),
      })
      .select("*")
      .single(),
  );
  revalidatePath("/big-swings");
  revalidatePath("/new");
  return created;
}

export async function deleteBigSwing(id: string) {
  // Briefs / Runs may reference this BigSwing via bigSwingId; FK constraint will
  // surface a useful error if so.
  const { error } = await supabase.from("BigSwing").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/big-swings");
  revalidatePath("/new");
}
