"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <div className="card"><p>Research could not be loaded.</p><button className="btn btn-secondary mt-3" onClick={reset}>Try again</button></div>; }
