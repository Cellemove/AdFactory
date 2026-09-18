import "server-only";
import { supabase } from "@/lib/db";
import { claimRun } from "./run-claim";

export async function claimModelRun(
  table: "CorpusTranscriptRun" | "CorpusExtractRun",
  id: string,
  startedAt: string,
  insert: Parameters<typeof claimRun>[0]["insert"],
  retryReview = false,
): Promise<boolean> {
  return claimRun({
    insert,
    async load() {
      const result = await supabase.from(table).select("status, startedAt").eq("id", id).single();
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    async retry(previous) {
      const result = await supabase.from(table).update({ status: "running", startedAt, completedAt: null, errorSummary: null })
        .eq("id", id).eq("status", previous.status).eq("startedAt", previous.startedAt).select("id");
      if (result.error) throw new Error(result.error.message);
      return result.data.length === 1;
    },
  }, retryReview);
}
