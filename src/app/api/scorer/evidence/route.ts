import { getSessionUser } from "@/lib/auth";
import { supabase } from "@/lib/db";
import type { ScriptEvidenceRow } from "@/lib/database.types";
import {
  EvidenceBulkUpdateSchema,
  getJsonStringArray,
  sortEvidenceNewestFirst,
} from "@/lib/cellumove/evidence-library";
import {
  EvidenceValidationError,
  bulkUpdateEvidence,
} from "@/lib/cellumove/evidence-library.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const denied = await authorize();
  if (denied) return denied;
  const url = new URL(request.url);
  const page = boundedInt(url.searchParams.get("page"), 1, 1, 10_000);
  const pageSize = boundedInt(url.searchParams.get("pageSize"), 50, 1, 200);
  const result = await supabase.from("ScriptEvidence").select("*").range(0, 999);
  if (result.error) return Response.json({ error: result.error.message }, { status: 500 });
  const filtered = sortEvidenceNewestFirst(
    (result.data ?? []).filter((item) => matchesFilters(item, url.searchParams)),
  );
  const start = (page - 1) * pageSize;
  return Response.json({
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
  });
}

export async function PATCH(request: Request): Promise<Response> {
  const denied = await authorize();
  if (denied) return denied;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Request body must be JSON." }, { status: 400 }); }
  const parsed = EvidenceBulkUpdateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid bulk update." }, { status: 422 });
  try {
    const items = await bulkUpdateEvidence(parsed.data.ids, parsed.data.patch);
    return Response.json({ items });
  } catch (error) {
    const status = error instanceof EvidenceValidationError ? 422 : 500;
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}

function matchesFilters(item: ScriptEvidenceRow, filters: URLSearchParams): boolean {
  const query = filters.get("q")?.trim().toLowerCase();
  if (query && ![item.externalId, item.title, item.avatar, item.angleSlug, item.scriptText].some((value) => value?.toLowerCase().includes(query))) return false;
  if (!equalsFilter(item.sheetName, filters.get("sheetName"))) return false;
  if (!equalsFilter(item.reviewStatus, filters.get("reviewStatus"))) return false;
  if (!equalsFilter(item.evidenceLevel, filters.get("evidenceLevel"))) return false;
  if (!equalsFilter(item.angleSlug, filters.get("angleSlug"))) return false;
  if (!equalsFilter(item.launchedStatus, filters.get("launchedStatus"))) return false;
  const sourceType = filters.get("sourceType");
  if (sourceType && sourceType !== "all" && !getJsonStringArray(item.sourceTypes).includes(sourceType)) return false;
  const hasScript = filters.get("hasScript");
  if (hasScript === "true" && !item.scriptText?.trim()) return false;
  if (hasScript === "false" && item.scriptText?.trim()) return false;
  const conflicts = filters.get("conflicts");
  if (conflicts === "true" && !getJsonStringArray(item.conflictFields).length) return false;
  if (conflicts === "false" && getJsonStringArray(item.conflictFields).length) return false;
  return true;
}

function equalsFilter(value: string | null, filter: string | null): boolean {
  return !filter || filter === "all" || value === filter;
}

function boundedInt(value: string | null, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

async function authorize(): Promise<Response | null> {
  const actor = await getSessionUser();
  if (!actor) return Response.json({ error: "Sign in to use scorer evidence." }, { status: 401 });
  return actor.role === "creative_strategist" ? null : Response.json({ error: "Only creative strategists can use scorer evidence." }, { status: 403 });
}
