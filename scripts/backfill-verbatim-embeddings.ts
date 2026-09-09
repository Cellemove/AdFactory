import { EMBED_MODEL, embedTexts } from "../src/lib/cellumove/embeddings";
import type { VerbatimRow } from "../src/lib/database.types";
import { supabase } from "../src/lib/db";

async function main() {
  let offset = 0;
  let updated = 0;
  for (;;) {
    const response = await supabase.from("Verbatim").select("*")
      .like("researchId", "verified:%")
      .is("embedding", null)
      .order("createdAt", { ascending: true })
      .range(offset, offset + 99);
    if (response.error) throw new Error(response.error.message);
    const rows = (response.data ?? []) as VerbatimRow[];
    if (!rows.length) break;
    const embeddings = await embedTexts(rows.map((row) => row.text));
    if (!embeddings || embeddings.length !== rows.length || embeddings.some((embedding) => embedding.length !== 768)) {
      throw new Error("Embedding service returned no data or vectors with an unexpected dimension.");
    }
    for (let index = 0; index < rows.length; index += 1) {
      const write = await supabase.from("Verbatim").update({
        embedding: `[${embeddings[index]!.join(",")}]`, embeddingModel: EMBED_MODEL, embeddingVersion: "v1",
      }).eq("id", rows[index]!.id);
      if (write.error) throw new Error(write.error.message);
      updated += 1;
    }
    console.log(`Embedded ${updated} verified verbatims.`);
    if (rows.length < 100) break;
    // The unembedded result set shrinks as rows are updated, so the next page
    // starts at zero rather than skipping records.
    offset = 0;
  }
  console.log(`Backfill complete: ${updated} rows updated with ${EMBED_MODEL}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

