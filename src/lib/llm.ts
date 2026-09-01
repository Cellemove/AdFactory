import { setDefaultResultOrder } from "node:dns";
import { GoogleGenAI } from "@google/genai";

// Prefer IPv4 for DNS resolution. Some networks (notably Windows hosts on certain
// ISPs) advertise AAAA records for oauth2.googleapis.com but refuse the IPv6
// connection, producing ECONNRESET / "fetch failed" during auth. IPv4-first is
// harmless on Vercel (their network does IPv6 cleanly).
setDefaultResultOrder("ipv4first");

// Gemini on Vertex AI. Auth flows through google-auth-library:
// - Local dev: Application Default Credentials (`gcloud auth application-default login`)
// - Vercel / production: GOOGLE_APPLICATION_CREDENTIALS_JSON (the full JSON contents of a service-account key)

let client: GoogleGenAI | null = null;

function getConfig() {
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const location = process.env.GOOGLE_CLOUD_LOCATION?.trim() || "global";
  return { project, location };
}

export function isLLMConfigured(): boolean {
  return Boolean(getConfig().project);
}

function loadInlineCredentials(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON missing client_email or private_key.");
    }
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch (e) {
    throw new Error(
      `Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function getLLM(): GoogleGenAI {
  const { project, location } = getConfig();
  if (!project) {
    throw new Error(
      "GOOGLE_CLOUD_PROJECT is not set. Add it to .env (and to Vercel env vars when deploying).",
    );
  }
  if (!client) {
    const inline = loadInlineCredentials();
    client = new GoogleGenAI({
      vertexai: true,
      project,
      location,
      ...(inline ? { googleAuthOptions: { credentials: inline } } : {}),
    });
  }
  return client;
}

// Model tiers. Pick per call site by what the task actually needs:
//
//   DEFAULT_MODEL (Pro)   — synthesis, copywriting, deep research. Reasoning that
//                           genuinely benefits from thinking.
//   FAST_MODEL (Flash)    — mechanical work: extraction, classification, JSON
//                           reshaping, OCR-style reads. ~4x cheaper per token.
//
// The tier also decides whether thinking can be switched OFF at all: Gemini 2.5
// Pro ALWAYS thinks (a thinkingBudget of 0 is ignored), while Flash and
// Flash-Lite honour `thinkingBudget: 0`. Since thinking bills at the output rate,
// a short-output mechanical task on Pro spends most of its cost on reasoning it
// does not need — those belong on FAST_MODEL with thinking disabled.
export const DEFAULT_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-pro";
export const FAST_MODEL =
  process.env.GEMINI_FAST_MODEL?.trim() || process.env.RESEARCH_FAST_MODEL?.trim() || "gemini-2.5-flash";
