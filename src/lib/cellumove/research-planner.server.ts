import { z } from "zod";
import { getLLM, isLLMConfigured } from "@/lib/llm";
import { recordUsage } from "@/lib/usage";
import type { ResearchQueryPlan, ResearchType } from "./research-evidence";

const RESEARCH_FAST_MODEL = process.env.RESEARCH_FAST_MODEL?.trim() || "gemini-2.5-flash";

const planSchema = z.object({
  facets: z.array(z.object({
    category: z.string().min(1),
    intent: z.string().min(1),
    queries: z.array(z.string().min(3)).min(1).max(5),
  })).min(4).max(8),
});

function fallbackPlan(type: ResearchType, brief: string): ResearchQueryPlan {
  const root = brief.replace(/\s+/g, " ").trim();
  const concepts = type === "concept";
  return {
    version: "v1",
    brief: root,
    facets: [
      { category: "pain", intent: "Find concrete daily frustrations and body sensations.", queries: [`${root} reddit daily struggle`, `${root} forum tried everything`] },
      { category: "desire", intent: "Find desired outcomes and emotional language.", queries: [`${root} reddit finally helped`, `${root} forum wish I could`] },
      { category: "objection", intent: "Find skepticism, failed alternatives, and purchase barriers.", queries: [`${root} reddit worth it`, `${root} forum did not work`] },
      { category: "trigger", intent: "Find moments that caused people to seek a solution.", queries: [`${root} reddit what made you`, `${root} my experience before after`] },
      ...(concepts ? [{ category: "winning_ads", intent: "Find currently running or high-engagement creative executions.", queries: [`${root} Meta Ads Library`, `${root} TikTok ad`, `${root} YouTube Shorts ad`] }] : []),
    ],
  };
}

export async function planResearchQueries(input: {
  type: ResearchType;
  angle?: string | null;
  mechanism?: string | null;
  focus?: string | null;
}): Promise<ResearchQueryPlan> {
  const brief = [input.angle, input.mechanism, input.focus].filter(Boolean).join(" — ") || input.type;
  const fallback = fallbackPlan(input.type, brief);
  if (!isLLMConfigured()) return fallback;

  try {
    const response = await getLLM().models.generateContent({
      model: RESEARCH_FAST_MODEL,
      contents: JSON.stringify({ researchType: input.type, angle: input.angle, mechanism: input.mechanism, focus: input.focus }),
      config: {
        systemInstruction: [
          "You plan evidence collection for customer and advertising research.",
          "Decompose the brief into 4-8 non-overlapping evidence facets.",
          "Each facet needs 2-5 concrete search queries. Prefer first-person communities for customer claims.",
          "For concept research include a winning_ads facet for real ad creatives.",
          "Do not synthesize findings. Return JSON only.",
        ].join("\n"),
        responseMimeType: "application/json",
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingBudget: 512 },
      },
    });
    await recordUsage({
      feature: "research_query_plan",
      model: RESEARCH_FAST_MODEL,
      usage: response.usageMetadata,
      metadata: { type: input.type, angle: input.angle ?? undefined },
    });
    const parsed = planSchema.safeParse(JSON.parse(response.text ?? "{}"));
    if (!parsed.success) return fallback;
    return { version: "v1", brief, facets: parsed.data.facets };
  } catch {
    return fallback;
  }
}

export function renderResearchQueryPlan(plan: ResearchQueryPlan): string {
  return [
    "EVIDENCE COLLECTION PLAN — execute every facet before synthesis:",
    ...plan.facets.flatMap((facet, index) => [
      `${index + 1}. ${facet.category}: ${facet.intent}`,
      ...facet.queries.map((query) => `   - ${query}`),
    ]),
  ].join("\n");
}

export function queryPlanQueries(plan: ResearchQueryPlan, max = 12): string[] {
  return plan.facets.flatMap((facet) => facet.queries).slice(0, max);
}

