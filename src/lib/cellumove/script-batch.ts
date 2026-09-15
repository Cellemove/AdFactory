// Batch variant construction + bounded-concurrency runner (pure, testable).
// One brief fans out along ONE of: frameworks (compare structures), or
// hook mechanics × optional heat levels (the engine's "many ways to say the
// same message" axis). Route: src/app/api/scripts/generate-batch/route.ts.
import type { HookSpec } from "@/lib/cellumove/formats";
import type { CreateScriptProjectInput } from "@/lib/cellumove/create-script-project.server";

export const MAX_BATCH_VARIANTS = 10;
export const BATCH_CONCURRENCY = 2;

export interface BatchVariant {
  key: string;
  label: string;
  input: CreateScriptProjectInput;
}

export function buildBatchVariants(
  base: CreateScriptProjectInput,
  axes: {
    frameworks?: { id: string; name: string }[];
    hookMechanics?: HookSpec[];
    heatLevels?: (1 | 2 | 3 | 4)[];
  },
): BatchVariant[] {
  const frameworks = axes.frameworks ?? [];
  const mechanics = axes.hookMechanics ?? [];
  const heats = axes.heatLevels ?? [];
  if (frameworks.length && (mechanics.length || heats.length)) {
    throw new Error("Frameworks are their own comparison — don't combine them with hook or heat axes.");
  }

  let variants: BatchVariant[];
  if (frameworks.length) {
    variants = frameworks.map((framework) => ({
      key: `fw:${framework.id}`,
      label: framework.name,
      input: {
        ...base,
        referenceFormatId: framework.id,
        title: `${base.title} · ${framework.name}`,
        creativeName: `${base.creativeName} ${framework.name}`.slice(0, 120),
      },
    }));
  } else {
    // Hook mechanics × heat. Either axis may be absent; [null] keeps the base value.
    const mechanicAxis: (HookSpec | null)[] = mechanics.length ? mechanics : [null];
    const heatAxis: ((1 | 2 | 3 | 4) | null)[] = heats.length ? heats : [null];
    variants = mechanicAxis.flatMap((mechanic) =>
      heatAxis.map((heat) => {
        const labels = [mechanic?.name, heat != null ? `Heat ${heat}` : null].filter(Boolean) as string[];
        const label = labels.join(" · ");
        return {
          key: `hook:${mechanic?.slug ?? "base"}:h${heat ?? "base"}`,
          label,
          input: {
            ...base,
            ...(mechanic
              ? {
                  // The engine builds the brief's HOOK inside — a mechanic
                  // becomes a directed hook brief, not a replacement idea.
                  hookDirection: [
                    `${mechanic.name} — ${mechanic.description}`,
                    `Example of the mechanic: "${mechanic.example}"`,
                    base.hookDirection ? `Also honour: ${base.hookDirection}` : null,
                  ].filter(Boolean).join(" "),
                }
              : {}),
            ...(heat != null ? { heatLevel: heat } : {}),
            title: `${base.title} · ${label}`,
            creativeName: `${base.creativeName} ${label.replace(/[^a-zA-Z0-9 ]+/g, "")}`.slice(0, 120),
          },
        };
      }),
    );
    if (variants.length === 1 && !mechanics.length && !heats.length) {
      throw new Error("Pick at least one batch axis: frameworks, hook mechanics, or heat levels.");
    }
  }

  if (variants.length < 2) throw new Error("A batch needs at least two variants.");
  if (variants.length > MAX_BATCH_VARIANTS) {
    throw new Error(`That's ${variants.length} variants — the batch ceiling is ${MAX_BATCH_VARIANTS}. Trim an axis.`);
  }
  return variants;
}

/** Order-preserving bounded-concurrency map. Rejections propagate to the caller's fn wrapper. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(lanes);
  return results;
}
