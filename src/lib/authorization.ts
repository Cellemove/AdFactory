import "server-only";

import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "@/lib/auth";

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireStrategist(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "creative_strategist") {
    throw new Error("Only creative strategists can change Script Studio projects.");
  }
  return user;
}

export async function requireEditor(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "editor") {
    throw new Error("Only editors can perform this action.");
  }
  return user;
}
