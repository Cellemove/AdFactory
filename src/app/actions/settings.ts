"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase, unwrap } from "@/lib/db";

const SettingsSchema = z.object({
  brandWordmarkPath: z.string().optional().nullable(),
  referenceImagePath: z.string().optional().nullable(),
  defaultEditor: z.enum(["MO", "VA", "DO"]).optional(),
  defaultTargetCount: z.coerce.number().int().min(1).max(40).optional(),
  allowedSkinTones: z.string().optional(),
});

export async function updateSettings(input: z.infer<typeof SettingsSchema>) {
  const parsed = SettingsSchema.parse(input);
  const row = {
    id: "default",
    brandWordmarkPath: parsed.brandWordmarkPath ?? null,
    referenceImagePath: parsed.referenceImagePath ?? null,
    defaultEditor: parsed.defaultEditor ?? "MO",
    defaultTargetCount: parsed.defaultTargetCount ?? 25,
    allowedSkinTones: parsed.allowedSkinTones ?? "Latina,White,Middle Eastern,Asian",
    updatedAt: new Date().toISOString(),
  };
  const res = await supabase.from("Settings").upsert(row).select("*").single();
  const saved = unwrap(res);
  revalidatePath("/settings");
  return saved;
}
