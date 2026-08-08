import Link from "next/link";
import { supabase, unwrap } from "@/lib/db";
import type { SubAvatarRow, AngleRow, AvatarResearchRow } from "@/lib/database.types";
import { NewSubAvatarForm } from "./NewSubAvatarForm";
import { NewAngleForm } from "./NewAngleForm";
import { ProductsSection } from "./ProductsSection";

type SubWithAngleResearch = SubAvatarRow & { angle: AngleRow; research: AvatarResearchRow | null };

export const dynamic = "force-dynamic";

export default async function AvatarsPage({
  searchParams,
}: {
  searchParams: Promise<{ angle?: string; new?: string }>;
}) {
  const sp = await searchParams;
  const [anglesRes, subsRes, productsRes] = await Promise.all([
    supabase.from("Angle").select("*").order("order", { ascending: true }),
    supabase
      .from("SubAvatar")
      .select("*, angle:Angle(*), research:AvatarResearch(*)")
      .order("name", { ascending: true }),
    supabase.from("Product").select("*").order("createdAt", { ascending: false }),
  ]);
  const angles = unwrap(anglesRes);
  const subs = unwrap(subsRes) as SubWithAngleResearch[];
  const products = unwrap(productsRes);

  const grouped = angles.map((a) => ({
    angle: a,
    subs: subs.filter((s) => s.angleId === a.id),
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Avatars</h1>
        <p className="text-sm text-ink-500">{angles.length} angles · sub-avatars + research. Wizard hard-blocks sub-avatars without research.</p>
      </header>

      <NewAngleForm />

      <NewSubAvatarForm angles={angles.map((a) => ({ slug: a.slug, name: a.name }))} preselectedAngle={sp.angle} openByDefault={sp.new === "1"} />

      <ProductsSection
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          imagePath: p.imagePath,
          description: p.description,
        }))}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {grouped.map(({ angle, subs }) => (
          <div key={angle.id} className="card">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{angle.name}</h2>
            </div>
            <p className="mt-1 text-xs text-ink-500">{angle.mechanism}</p>
            <div className="divider" />
            {subs.length === 0 ? (
              <p className="text-sm text-ink-500">No sub-avatars yet.</p>
            ) : (
              <ul className="space-y-2">
                {subs.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/avatars/${s.slug}`}
                      className="flex items-center justify-between rounded-md border border-ink-200 p-2.5 hover:bg-ink-100"
                    >
                      <div>
                        <div className="text-sm font-medium">{s.name}</div>
                        {s.shortDesc && <div className="text-xs text-ink-500">{s.shortDesc}</div>}
                      </div>
                      <span className={`tag ${s.research ? "tag-ok" : "tag-danger"}`}>
                        {s.research ? "research ✓" : "no research"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
