/**
 * Minimal user profile shape for the sidebar user area.
 */
export interface SidebarProfile {
  email: string;
  initials: string;
  tenantName: string;
  isAdmin?: boolean;
  /**
   * True iff the caller's role is "trainer" AND their resolved billing tier
   * is exactly "trainer" (#453) — the SAME gate `assertTrainerEntitled`
   * enforces server-side. Drives the layout's Clients nav entry directly off
   * this profile fetch instead of a separate `GET /trainer/clients`
   * round-trip (`fetchClients`, removed).
   */
  isTrainer?: boolean;
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
    isAdmin: payload.isAdmin === true,
    isTrainer: payload.isTrainer === true,
  };
}
