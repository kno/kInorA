/**
 * Minimal user profile shape for the sidebar user area.
 */
export interface SidebarProfile {
  email: string;
  initials: string;
  tenantName: string;
}

/**
 * Fetch the authenticated user's profile from the API.
 * Returns `null` on any failure (unauthenticated, network, invalid response).
 * The caller (a Server Action or layout) degrades to the existing fallback.
 */
export async function fetchProfile(token: string): Promise<SidebarProfile | null> {
  const base = process.env.API_BASE_URL ?? "http://localhost:4000";

  let res: Response;
  try {
    res = await fetch(`${base}/auth/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const payload = (await res.json().catch(() => null)) as Partial<SidebarProfile> | null;
  if (!payload?.email || !payload.initials) return null;

  return {
    email: payload.email,
    initials: payload.initials,
    tenantName: payload.tenantName ?? "",
  };
}
