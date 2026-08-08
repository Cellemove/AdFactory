// Reverse-engineer a winning ad from its Facebook post link.
//
// Harvests the post's creative (og:image) + primary text (og:description) — via
// curl, because FB's edge blocks Node fetch's client fingerprint but lets curl
// through — then shows BOTH to Gemini and asks it to "see" the ad: what it's
// about, why it wins, and a ready-to-shoot script in the G6 beat format.
//
// Run: npx tsx --env-file=.env scripts/reverse-engineer-ad.ts <fbPostUrl> ["context note"]
// e.g. npx tsx --env-file=.env scripts/reverse-engineer-ad.ts \
//        "https://www.facebook.com/61578.../posts/122148.../" "ROAS 2.74 · spend 85.61 · market ES"
//
// NOTE: local-machine tool. The deployed app cannot do this server-side (FB
// blocks its runtime fingerprint) — productizing means either batch-running this
// locally and storing results, or a Meta Graph API token.

import { execFileSync } from "node:child_process";
import { getLLM, DEFAULT_MODEL } from "../src/lib/llm";
import { CLAIMS_GUARDRAIL } from "../src/lib/cellumove/pipeline-stages";

// IMPORTANT: keep this UA SHORT/generic. FB 400-blocks a full "Chrome/124" UA
// claim when the TLS fingerprint doesn't match real Chrome; the generic UA passes.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

function curl(url: string): Buffer {
  return execFileSync("curl", ["-sL", "-A", UA, url], { maxBuffer: 64 * 1024 * 1024 });
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function metaTag(html: string, prop: string): string | null {
  const m =
    html.match(new RegExp(`<meta[^>]*property="${prop}"[^>]*content="([^"]*)"`, "i")) ||
    html.match(new RegExp(`<meta[^>]*content="([^"]*)"[^>]*property="${prop}"`, "i"));
  return m?.[1]?.trim() ? decodeEntities(m[1]) : null;
}

// FB intermittently serves a block/variant page — retry a few times before giving up.
function fetchPostHtml(url: string, attempts = 4): string {
  let last = "";
  for (let i = 0; i < attempts; i++) {
    const html = curl(url).toString("utf8");
    console.log(`  attempt ${i + 1}: ${(html.length / 1024).toFixed(0)} KB${/property="og:image"/i.test(html) ? " · og:image ✓" : ""}`);
    if (/property="og:image"/i.test(html)) return html;
    last = html;
  }
  return last;
}

const PROMPT = [
  "You are a senior direct-response creative strategist for CelluMove — 3D-shaping compression leggings.",
  "You are shown ONE of our own WINNING Meta ads: the creative image and (when available) its primary text.",
  "REVERSE-ENGINEER it so the team understands exactly why it wins and can reproduce/iterate it.",
  CLAIMS_GUARDRAIL,
  "",
  "Return ONLY a JSON object — no prose, no markdown fences:",
  `{
  "whatItsAbout": "2-3 sentences — what the ad is about and the promise it makes",
  "angle": "the angle it plays (e.g. cellulite, heavy legs, lipedema, chafing)",
  "awarenessLevel": "unaware|problem-aware|solution-aware|product-aware|most-aware",
  "hookMechanic": "the hook mechanic (question, transformation, demo, social-proof, contrarian, …)",
  "visualBreakdown": "what is literally in the creative and why it stops the scroll",
  "copyBreakdown": "how the primary text works — structure, emotional levers, promise (or note if none available)",
  "whyItWins": "the likely reason this converts, tied to the avatar psychology",
  "script": {
    "title": "short name for the reproduced concept",
    "hook": "the opening line/moment",
    "beats": [ { "time": "0-3s", "visual": "…", "onScreenText": "…", "voiceover": "…" } ],
    "cta": "closing call to action"
  },
  "iterationIdeas": ["3-5 ways to iterate WITHOUT losing what makes it work"]
}`,
].join("\n");

async function main() {
  const [postUrl, note] = process.argv.slice(2);
  if (!postUrl) {
    console.error('Usage: npx tsx --env-file=.env scripts/reverse-engineer-ad.ts <fbPostUrl> ["context note"]');
    process.exit(1);
  }

  console.log(`Harvesting ${postUrl} …`);
  const html = fetchPostHtml(postUrl);
  const imageUrl = metaTag(html, "og:image");
  const adText = metaTag(html, "og:description");
  const pageTitle = metaTag(html, "og:title");
  if (!imageUrl) throw new Error("No og:image found — post may be private/removed, or FB served a block page.");
  console.log(`  creative image: ${imageUrl.slice(0, 80)}…`);
  console.log(`  primary text:  ${adText ? `"${adText.slice(0, 100)}…"` : "(none exposed — likely a video post; analyzing the thumbnail)"}`);

  const imageBytes = curl(imageUrl);
  const mime = /\.png(\?|$)/i.test(imageUrl) ? "image/png" : "image/jpeg";
  console.log(`  downloaded creative: ${(imageBytes.length / 1024).toFixed(0)} KB\n`);

  const userText = [
    "WINNING AD TO REVERSE-ENGINEER:",
    pageTitle ? `Page: ${pageTitle}` : "",
    note ? `Performance/context: ${note}` : "",
    adText ? `PRIMARY TEXT (verbatim): ${adText}` : "PRIMARY TEXT: not exposed (video post) — infer from the creative.",
    "",
    "The image attached is the ad creative. Analyze it and return the JSON.",
  ]
    .filter(Boolean)
    .join("\n");

  const llm = getLLM();
  const resp = await llm.models.generateContent({
    model: DEFAULT_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: mime, data: imageBytes.toString("base64") } },
          { text: `${PROMPT}\n\n${userText}` },
        ],
      },
    ],
    config: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 2048 } },
  });

  const text = resp.text ?? "";
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? text).trim();
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  const parsed = JSON.parse(body.slice(first, last + 1)) as Record<string, unknown>;

  console.log(JSON.stringify(parsed, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
