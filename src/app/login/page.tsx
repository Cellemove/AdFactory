import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · CelluMove Ad Factory" };

export default function LoginPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-ink-50 bg-[radial-gradient(ellipse_at_top,rgba(255,109,180,0.06),transparent_60%)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="inline-block h-6 w-6 rounded-sm bg-brand-pink" />
          <span className="text-lg font-semibold tracking-tight">AdFactory</span>
        </div>
        <div className="card p-6 shadow-card-hover">
          <Suspense fallback={<div className="text-sm text-ink-500">Loading…</div>}>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-4 text-center text-xs text-ink-400">CelluMove Ad Factory · internal tool</p>
      </div>
    </div>
  );
}
