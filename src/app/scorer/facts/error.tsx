"use client";

export default function FactsError({ error, reset }: { error: Error; reset: () => void }) {
  return <div className="card border-red-200 bg-red-50"><h2 className="font-semibold text-red-900">Facts and offers could not load</h2><p className="mt-2 text-sm text-red-800">{error.message}</p><button type="button" className="btn mt-4" onClick={reset}>Try again</button></div>;
}
