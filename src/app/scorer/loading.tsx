export default function ScorerLoading() {
  return <div className="space-y-4"><div className="skeleton-line h-8 w-48" /><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="card"><div className="skeleton-line h-20" /></div>)}</div><div className="card"><div className="skeleton-line h-48" /></div></div>;
}

