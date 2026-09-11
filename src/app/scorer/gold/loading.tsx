export default function GoldLoading() {
  return <div className="space-y-4"><div className="skeleton-line h-8 w-56" /><div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((item) => <div className="card" key={item}><div className="skeleton-line h-20" /></div>)}</div><div className="card"><div className="skeleton-line h-64" /></div></div>;
}
