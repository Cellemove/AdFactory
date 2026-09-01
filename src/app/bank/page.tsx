import type { Metadata } from "next";
import { listBankedAds } from "../actions/bank";
import { BankClient } from "./BankClient";

export const metadata: Metadata = { title: "Idea Bank · AdFactory" };
export const dynamic = "force-dynamic";

export default async function BankPage() {
  const { items, needsMigration } = await listBankedAds();
  return <BankClient items={items} needsMigration={needsMigration} />;
}
