export default function ScriptsLoading() {
  return <div className="space-y-4"><div className="skeleton-line h-8 w-48" /><div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="skeleton-line h-24" />)}</div><div className="skeleton-line h-80" /></div>;
}
