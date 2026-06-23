import { logoutAction } from "./actions";

/**
 * Dashboard — protected page only accessible with a valid session.
 *
 * The proxy (`proxy.ts`) gates this route: no `kinora_session`
 * cookie → redirect to `/login`. If you can see this page you are
 * authenticated (cookie present — full session validation delegated
 * to the API, 05b owns 401/403 reject policy).
 */
export default function DashboardPage() {
  return (
    <main className="kin-page">
      <div className="kin-card kin-card--center">
        <h1 className="kin-title">Dashboard</h1>
        <p className="kin-text kin-muted">You are authenticated.</p>

        <form action={logoutAction}>
          <button type="submit" className="kin-btn kin-btn--danger">
            Log out
          </button>
        </form>
      </div>
    </main>
  );
}