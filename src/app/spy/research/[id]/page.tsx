import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { getResearchSnapshot } from "@/lib/brandsearch-research.server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Imported ad research · AdFactory" };

export default async function ResearchPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const research = await getResearchSnapshot(id);
  return <div className="mx-auto max-w-5xl space-y-6">
    <header><Link href="/spy" className="text-sm text-violet-700">← Competitor Spy</Link>
      <h1 className="mt-3 text-2xl font-semibold">{research.brand} · imported research</h1>
      <p className="mt-2 text-sm text-ink-500">Speech: {research.transcript.status} · AI context: {research.analysis.status} · retrieved {new Date(research.retrievedAt).toISOString()}</p>
    </header>
    <div className="card border-amber-200 bg-amber-50 text-sm">On-screen text and visuals have not been assessed. BrandSearch AI interpretations are research suggestions. Competitor claims and offers are not approved facts for your product.</div>
    <div className="flex gap-3"><Link className="btn btn-primary" href={`/scripts/new?researchSnapshotId=${encodeURIComponent(id)}`}>Use as script reference</Link><Link className="btn btn-secondary" href={`/miner/${research.competitorAdId}`}>Full ad details</Link></div>
    <section className="card space-y-3"><h2 className="text-lg font-semibold">Listing copy</h2>{Object.entries(research.copy).map(([key, value]) => <div key={key}><h3 className="font-medium capitalize">{key}</h3><p className="whitespace-pre-wrap text-sm">{value || "Not provided"}</p></div>)}</section>
    <section className="card space-y-3"><h2 className="text-lg font-semibold">Speech and opening hook</h2><p>{research.transcript.hook || "No hook provided"}</p>
      {research.transcript.error && <p className="text-red-700">{research.transcript.error}</p>}
      {research.transcript.status === "empty" && <p>BrandSearch reports no spoken content.</p>}
      <table className="w-full text-left text-sm"><thead><tr><th className="p-2">Time</th><th className="p-2">Provider transcript</th></tr></thead><tbody>{research.transcript.segments.map((s, i) => <tr key={i} className="border-t"><td className="whitespace-nowrap p-2 align-top">{s.start.toFixed(1)}–{s.end.toFixed(1)}s</td><td className="p-2">{s.text}</td></tr>)}</tbody></table>
    </section>
    <section className="card space-y-3"><h2 className="text-lg font-semibold">Provider interpretation · unverified</h2><p className="text-sm">{research.analysis.error || (research.analysis.status === "missing" ? "No cached analysis available. No new AI analysis was purchased." : "Imported from BrandSearch. Review before reuse.")}</p>
      {research.analysis.interpretation != null && <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(research.analysis.interpretation, null, 2)}</pre>}
    </section>
  </div>;
}
