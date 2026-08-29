"use client";

export default function ProductsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card border-red-300 bg-red-50">
      <h1 className="font-semibold text-red-900">Products could not load</h1>
      <p className="mt-2 text-sm text-red-700">{error.message}</p>
      <button className="btn mt-4" onClick={reset}>Try again</button>
    </div>
  );
}
