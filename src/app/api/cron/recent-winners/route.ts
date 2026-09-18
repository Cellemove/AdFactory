import { runRecentWinners } from "@/lib/cellumove/corpus/runner.server";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return Response.json(await runRecentWinners({ budgetMs: 450_000 }));
  } catch (error) {
    console.error("[recent-winners] failed", error);
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
