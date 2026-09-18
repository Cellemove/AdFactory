import { redirect } from "next/navigation";

/** Run pipeline moved to /miner. Kept so older links and docs still work. */
export default async function LegacyRunPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const { brand } = await searchParams;
  redirect(brand ? `/miner?brand=${encodeURIComponent(brand)}` : "/miner");
}
