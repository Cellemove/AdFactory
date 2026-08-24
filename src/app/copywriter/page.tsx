import { supabase } from "@/lib/db";
import { parseCopySessionDoc } from "@/lib/cellumove/copy-session";
import {
  CopywriterClient,
  type SubOption,
  type SessionSummary,
  type ActiveSession,
} from "./CopywriterClient";

export const dynamic = "force-dynamic";

interface SessionRow {
  id: string;
  focus: string | null;
  angleSlug: string | null;
  drafts: string;
  createdAt: string;
}

export default async function CopywriterPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>;
}) {
  const { s } = await searchParams;

  const [anglesRes, subsRes, researchRes, sessionsRes] = await Promise.all([
    supabase.from("Angle").select("id, slug, name"),
    supabase.from("SubAvatar").select("id, name, shortDesc, angleId"),
    supabase.from("AvatarResearch").select("subAvatarId"),
    supabase
      .from("Research")
      .select("id, focus, angleSlug, drafts, createdAt")
      .eq("type", "copywriter")
      .order("createdAt", { ascending: false })
      .limit(40),
  ]);

  const angles = (anglesRes.data ?? []) as { id: string; slug: string; name: string }[];
  const subs = (subsRes.data ?? []) as {
    id: string;
    name: string;
    shortDesc: string | null;
    angleId: string;
  }[];
  const researched = new Set(
    ((researchRes.data ?? []) as { subAvatarId: string }[]).map((r) => r.subAvatarId),
  );
  const angleById = new Map(angles.map((a) => [a.id, a.name]));

  // Same readiness bar as the pipeline: only researched avatars can open a session.
  const subOptions: SubOption[] = subs
    .filter((sub) => researched.has(sub.id))
    .map((sub) => ({
      id: sub.id,
      name: sub.name,
      shortDesc: sub.shortDesc,
      angleName: angleById.get(sub.angleId) ?? "—",
    }));

  const rows = (sessionsRes.error ? [] : (sessionsRes.data ?? [])) as SessionRow[];
  const sessions: SessionSummary[] = rows.map((r) => ({
    id: r.id,
    avatarName: r.focus ?? "—",
    angleSlug: r.angleSlug,
    asks: parseCopySessionDoc(r.drafts).turns.filter((t) => t.role === "user").length,
    createdAt: r.createdAt,
  }));

  // Selected session: usually in the list; fall back to a direct fetch for deep
  // links older than the list window.
  let activeRow = s ? (rows.find((r) => r.id === s) ?? null) : null;
  if (s && !activeRow) {
    const one = await supabase
      .from("Research")
      .select("id, focus, angleSlug, drafts, createdAt")
      .eq("id", s)
      .eq("type", "copywriter")
      .maybeSingle();
    if (!one.error && one.data) activeRow = one.data as SessionRow;
  }
  const active: ActiveSession | null = activeRow
    ? {
        id: activeRow.id,
        avatarName: activeRow.focus ?? "—",
        turns: parseCopySessionDoc(activeRow.drafts).turns,
      }
    : null;

  return (
    <CopywriterClient
      key={active?.id ?? "none"}
      subOptions={subOptions}
      sessions={sessions}
      active={active}
    />
  );
}
