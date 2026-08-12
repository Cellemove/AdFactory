import Link from "next/link";
import { LogoMark } from "@/components/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <LogoMark className="h-12 w-12" />
      <div>
        <p className="text-7xl font-semibold tracking-tighter text-brand-plum sm:text-8xl">404</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
        <p className="mt-1 max-w-sm text-sm text-ink-500">
          It may have been removed in a cleanup — Excavation now lives in the Pipeline, and run
          history is under History.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/" className="btn btn-primary">Go to Dashboard</Link>
        <Link href="/pipeline" className="btn">Open Pipeline</Link>
        <Link href="/runs" className="btn">History</Link>
      </div>
    </div>
  );
}
