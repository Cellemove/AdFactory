// AdFactory environment truth-check (P0 item 2). Read-only probes; prints no secrets.
import { createClient } from "@supabase/supabase-js";

type Result = [name: string, ok: boolean, note: string];
const results: Result[] = [];
const log = (name: string, ok: boolean, note = "") => results.push([name, ok, note]);
const env = (k: string) => (process.env[k] ?? "").trim();

async function main() {
  // ── Supabase + migrations ──────────────────────────────────────────────────
  const url = env("NEXT_PUBLIC_SUPABASE_URL") || env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  log("env: SUPABASE_URL", !!url);
  log("env: SUPABASE_SERVICE_ROLE_KEY", !!key);
  if (url && key) {
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const probe = async (
      label: string,
      fn: () => PromiseLike<{ error: { message: string } | null; count?: number | null }>,
    ) => {
      try {
        const r = await fn();
        log(label, !r.error, r.error ? r.error.message.slice(0, 90) : r.count != null ? `${r.count} rows` : "ok");
      } catch (e) {
        log(label, false, String(e instanceof Error ? e.message : e).slice(0, 90));
      }
    };
    await probe("Supabase reachable / Research (001)", () => sb.from("Research").select("id", { head: true, count: "exact" }));
    await probe("Sop table + seed (001)", () => sb.from("Sop").select("id", { head: true, count: "exact" }));
    await probe("Verbatim (002)", () => sb.from("Verbatim").select("id", { head: true, count: "exact" }));
    await probe("AvatarResearch.profile col (003)", () => sb.from("AvatarResearch").select("profile").limit(1));
    await probe("EditorClaim (004)", () => sb.from("EditorClaim").select("id", { head: true, count: "exact" }));
    await probe("AppUser (005)", () => sb.from("AppUser").select("id", { head: true, count: "exact" }));
    await probe("PerformanceEntry (006)", () => sb.from("PerformanceEntry").select("id", { head: true, count: "exact" }));
    await probe("BrollClip (007)", () => sb.from("BrollClip").select("id", { head: true, count: "exact" }));
    await probe("BrollClip intel cols (008)", () => sb.from("BrollClip").select("timesSuggested, aiDescription").limit(1));
    await probe("BrollSuggestion (008)", () => sb.from("BrollSuggestion").select("id", { head: true, count: "exact" }));
  }

  // ── Vertex / Gemini ────────────────────────────────────────────────────────
  const project = env("GOOGLE_CLOUD_PROJECT");
  log("env: GOOGLE_CLOUD_PROJECT", !!project, project ? "" : "required for all Gemini calls");
  const saJson = !!env("GOOGLE_APPLICATION_CREDENTIALS_JSON");
  log("GCP auth mode", true, saJson ? "service-account JSON" : "ADC (gcloud login)");
  if (project) {
    try {
      const { GoogleGenAI } = await import("@google/genai");
      // Mirror src/lib/llm.ts: pass the SA from GOOGLE_APPLICATION_CREDENTIALS_JSON
      // explicitly — the auth library does NOT read that env var on its own, and
      // falling back to machine ADC would test the wrong principal.
      const rawSa = env("GOOGLE_APPLICATION_CREDENTIALS_JSON");
      const sa = rawSa ? (JSON.parse(rawSa) as { client_email?: string; private_key?: string }) : null;
      const llm = new GoogleGenAI({
        vertexai: true,
        project,
        location: env("GOOGLE_CLOUD_LOCATION") || "global",
        ...(sa?.client_email && sa?.private_key
          ? { googleAuthOptions: { credentials: { client_email: sa.client_email, private_key: sa.private_key } } }
          : {}),
      });
      const r = await llm.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "Reply with exactly: OK",
        config: { maxOutputTokens: 50, thinkingConfig: { thinkingBudget: 0 } },
      });
      const text = (r.text ?? "").trim();
      log("Vertex Gemini live call", !!text, text.slice(0, 20) || "empty response");
    } catch (e) {
      log("Vertex Gemini live call", false, String(e instanceof Error ? e.message : e).slice(0, 140));
    }
  }

  // ── Reddit OAuth ───────────────────────────────────────────────────────────
  const rid = env("REDDIT_CLIENT_ID");
  const rsec = env("REDDIT_CLIENT_SECRET");
  // Reddit is optional by choice (creds removed 2026-08-24) — absent is fine.
  log("env: REDDIT_CLIENT_ID/SECRET (optional)", true, rid && rsec ? "set" : "not set — research runs without Reddit");
  if (rid && rsec) {
    try {
      const resp = await fetch("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${rid}:${rsec}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": env("REDDIT_USER_AGENT") || "adfactory-envcheck/1.0",
        },
        body: "grant_type=client_credentials",
      });
      const j = (await resp.json().catch(() => ({}))) as { access_token?: string };
      log("Reddit OAuth token", resp.ok && !!j.access_token, `HTTP ${resp.status}`);
    } catch (e) {
      log("Reddit OAuth token", false, String(e instanceof Error ? e.message : e).slice(0, 90));
    }
  }

  // ── Other env ──────────────────────────────────────────────────────────────
  log("env: GOOGLE_DRIVE_BROLL_FOLDER_ID", !!env("GOOGLE_DRIVE_BROLL_FOLDER_ID"), "b-roll sync");
  log("env: BLOB_READ_WRITE_TOKEN", !!env("BLOB_READ_WRITE_TOKEN"), "image uploads");

  const w = Math.max(...results.map((r) => r[0].length));
  for (const [n, ok, note] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n.padEnd(w)}  ${note}`);
  const fails = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  process.exit(fails ? 1 : 0);
}

main();
