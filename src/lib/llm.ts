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

export const DEFAULT_MODEL = "gemini-2.5-pro";
