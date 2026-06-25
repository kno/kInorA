"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { submitLogin } from "./submit-login";
import { SESSION_COOKIE } from "@/auth/session-cookie";

/**
 * Login Server Action.
 *
 * Wired to the login form via `<form action={loginAction}>`. Delegates the
 * API call + result mapping to the pure, unit-tested `submitLogin`. On
 * success it persists the opaque session token in the `kinora_session`
 * httpOnly cookie (same cookie the social callback writes and the proxy
 * reads) and redirects to the app home. On failure it redirects back to
 * `/login` with an `error` query param.
 *
 * This is thin framework glue: all branching logic lives in `submitLogin`
 * (covered by its unit tests). 05a/05b seam — this issues no 401/403; it
 * only redirects.
 */
export async function loginAction(formData: FormData): Promise<void> {
  const result = await submitLogin(formData);

  if (result.kind === "error") {
    redirect(`/login?error=${encodeURIComponent(result.message)}`);
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  redirect("/");
}
