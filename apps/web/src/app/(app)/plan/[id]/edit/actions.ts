"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { WorkoutProgram } from "@kinora/contracts";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { updatePlanProgram, type UpdateProgramResult } from "./program-edit-client";

/**
 * Server Action for saving a program edit (17d PR D). Thin framework glue —
 * the branching lives in the unit-tested `program-edit-client.ts`.
 *
 * On success it revalidates `/plan` and `/plans`, because those surfaces
 * render day tiles derived from `program.weeklySessions`: without this, the
 * tab that just removed a day would keep offering to start it from a cached
 * segment, and the start would come back as `day_not_in_plan`. #415 makes the
 * same two revalidations carry the renamed plan's label — one write, every
 * surface — which is why rename needed no new cache invalidation of its own.
 */
export async function updatePlanProgramAction(
  planId: string,
  program: WorkoutProgram,
  expectedVersion: number,
  name?: string,
): Promise<UpdateProgramResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const result = await updatePlanProgram(planId, program, expectedVersion, name, token);
  if (result.kind === "ok") {
    revalidatePath("/plan");
    revalidatePath("/plans");
  }
  return result;
}
