export default function ProductsLoading() {
  return (
    <div className="space-y-5">
      <div className="skeleton-line h-8 w-56" />
      <div className="skeleton-line h-4 w-96 max-w-full" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((item) => <div key={item} className="skeleton-line h-32" />)}
      </div>
    </div>
  );
}
