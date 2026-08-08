import { getLLM, DEFAULT_MODEL } from "@/lib/llm";

async function main() {
  const client = getLLM();
  const resp = await client.models.generateContent({
    model: DEFAULT_MODEL,
    contents: 'Reply with exactly: "Vertex OK"',
    config: { maxOutputTokens: 256 },
  });
  console.log("model:", DEFAULT_MODEL);
  console.log("response:", resp.text?.trim());
  console.log("usage:", resp.usageMetadata);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
