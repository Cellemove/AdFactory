import { Suspense } from "react";
import { LogoMark } from "@/components/logo";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · AdFactory" };

export default function LoginPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-ink-50 bg-[radial-gradient(ellipse_at_top,rgba(221,136,207,0.10),transparent_60%)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <LogoMark className="h-6 w-6" />
          <span className="text-lg font-semibold tracking-tight">AdFactory</span>
        </div>
        <div className="card p-6 shadow-card-hover">
          <Suspense fallback={<div className="text-sm text-ink-500">Loading…</div>}>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-4 text-center text-xs text-ink-400">AdFactory · internal tool</p>
      </div>
    </div>
  );
}
