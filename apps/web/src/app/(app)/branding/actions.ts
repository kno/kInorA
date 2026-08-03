"use server";

import { cookies } from "next/headers";
import type { BrandingPalette } from "@kinora/contracts";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import {
  updateBranding,
  uploadLogo,
  type UpdateBrandingResult,
  type UploadLogoResult,
} from "./branding-client";

/**
 * Server Actions for the Branding Studio (16a-v3-gym-white-label).
 *
 * Thin framework glue over the unit-tested `branding-client.ts`. Each reads
 * the opaque session token from the `kinora_session` httpOnly cookie and
 * forwards it as a Bearer token to the API server-to-server — the browser
 * never calls the gym-gated API directly, and the token never reaches client
 * JS (mirrors `tenant-provisioning/actions.ts`).
 */

async function token(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

export async function saveBrandingAction(input: {
  subdomainSlug: string;
  palette: BrandingPalette;
}): Promise<UpdateBrandingResult> {
  return updateBranding(await token(), input);
}

export async function uploadLogoAction(formData: FormData): Promise<UploadLogoResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { kind: "invalid" };
  }
  return uploadLogo(await token(), file);
}
