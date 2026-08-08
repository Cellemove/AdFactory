"use client";

import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { signInAction, signUpAction } from "../actions/auth";
import type { Role } from "@/lib/roles";

type Mode = "signin" | "signup";

export function LoginForm() {
  const search = useSearchParams();
  const next = search.get("next") || "/";

  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("creative_strategist");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      // On success these redirect (no return); only errors come back.
      const res =
        mode === "signin"
          ? await signInAction({ username, password, next })
          : await signUpAction({ username, password, role, next });
      if (res?.error) setError(res.error);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <h1 className="text-base font-semibold text-ink-900">
          {mode === "signin" ? "Sign in" : "Create account"}
        </h1>
        <p className="text-xs text-ink-500">
          {mode === "signin" ? "Access the Ad Factory." : "Register a new teammate."}
        </p>
      </div>

      <div>
        <label className="label" htmlFor="username">Username</label>
        <input
          id="username"
          type="text"
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="e.g. jane"
          required
          disabled={pending}
        />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          required
          minLength={6}
          disabled={pending}
        />
      </div>

      {mode === "signup" && (
        <div>
          <label className="label" htmlFor="role">I am a…</label>
          <select
            id="role"
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            disabled={pending}
          >
            <option value="creative_strategist">Creative Strategist · full access</option>
            <option value="editor">Editor · claim work &amp; read reviews</option>
          </select>
        </div>
      )}

      {error && <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800">{error}</div>}

      <button type="submit" className="btn btn-primary w-full" disabled={pending || !username || !password}>
        {pending ? "…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>

      <button
        type="button"
        className="w-full text-center text-xs text-ink-500 underline hover:text-ink-900"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
        }}
        disabled={pending}
      >
        {mode === "signin" ? "Need an account? Create one" : "Have an account? Sign in"}
      </button>
    </form>
  );
}
