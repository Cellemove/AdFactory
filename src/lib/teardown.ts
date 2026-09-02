import "server-only";

import { z } from "zod";
import { ParsedTeardownWorkbookSchema } from "@/lib/cellumove/teardown-brief";
import { resolveTeardownConfiguration } from "@/lib/teardown-config";

const TeardownSummarySchema = z.object({
  id: z.string(),
  ad_name: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  original_filename: z.string(),
  source_url: z.string().nullable().optional(),
  ad_kind: z.enum(["image", "video"]),
  field_count: z.number().int().nonnegative(),
  created_at: z.string(),
  completed_at: z.string().nullable().optional(),
}).passthrough();

const TeardownRecordSchema = TeardownSummarySchema.extend({
  status: z.literal("completed"),
  parsed_output: ParsedTeardownWorkbookSchema,
  raw_output: z.string().nullable().optional(),
}).passthrough();

const TeardownListSchema = z.object({
  contract_version: z.literal("1"),
  items: z.array(TeardownSummarySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

const TeardownDetailSchema = z.object({
  contract_version: z.literal("1"),
  record: TeardownRecordSchema,
});

export type TeardownSummary = z.infer<typeof TeardownSummarySchema>;
export type TeardownRecord = z.infer<typeof TeardownRecordSchema>;

export function parseTeardownRecord(value: unknown): TeardownRecord | null {
  const parsed = TeardownRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isTeardownConfigured(): boolean {
  return resolveTeardownConfiguration().configuration !== null;
}

export function getTeardownConfigurationIssue(): string | null {
  return resolveTeardownConfiguration().issue;
}

async function teardownFetch(path: string): Promise<unknown> {
  const status = resolveTeardownConfiguration();
  if (!status.configuration) {
    throw new Error(
      status.issue ?? "TEARDOWN_API_BASE_URL and TEARDOWN_INTERNAL_TOKEN are required.",
    );
  }
  const config = status.configuration;

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/integrations/adfactory${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json", "X-AdFactory-Token": config.token },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const detail = error instanceof Error && error.name === "TimeoutError"
      ? "The request timed out."
      : "The API could not be reached.";
    throw new Error(`Could not connect to Teardown2 at ${new URL(config.baseUrl).origin}. ${detail}`);
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error("Teardown2 rejected the AdFactory token.");
    if (response.status === 503) throw new Error("Teardown2 has not enabled the AdFactory integration.");
    throw new Error(`Teardown2 returned ${response.status}.`);
  }
  return response.json();
}

export async function listTeardownDeconstructions(): Promise<TeardownSummary[]> {
  return TeardownListSchema.parse(await teardownFetch("/deconstructions?limit=100")).items;
}

export async function getTeardownDeconstruction(id: string): Promise<TeardownRecord> {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid Teardown2 record id.");
  return TeardownDetailSchema.parse(
    await teardownFetch(`/deconstructions/${encodeURIComponent(id)}`),
  ).record;
}
