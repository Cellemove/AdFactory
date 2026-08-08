import { supabase, unwrap } from "@/lib/db";
import { SwipeClient } from "./SwipeClient";

export const dynamic = "force-dynamic";

export default async function SwipeFilePage() {
  const res = await supabase.from("SwipeFile").select("*").order("createdAt", { ascending: false });
  const items = unwrap(res);
  return (
    <SwipeClient
      items={items.map((s) => ({
        id: s.id,
        title: s.title,
        brand: s.brand,
        category: s.category,
        notes: s.notes,
        imagePath: s.imagePath,
        sourceUrl: s.sourceUrl,
        tags: s.tags,
        createdAt: s.createdAt,
      }))}
    />
  );
}
