"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { submitSignup } from "./submit-signup";
import { SESSION_COOKIE } from "@/auth/session-cookie";

/**
 * Sign-up Server Action.
 *
 * Wired to the sign-up form via `<form action={signupAction}>`. On success
 * it persists the session token and redirects home; on failure it redirects
 * back to `/sign-up?error=...`. Same cookie and redirect pattern as
 * `loginAction`.
 */
export async function signupAction(formData: FormData): Promise<void> {
  const result = await submitSignup(formData);

  if (result.kind === "error") {
    redirect(`/sign-up?error=${encodeURIComponent(result.message)}`);
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  redirect("/");
}
