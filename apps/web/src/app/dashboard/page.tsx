import { logoutAction } from "./actions";

/**
 * Dashboard — protected page only accessible with a valid session.
 *
 * The middleware (`middleware.ts`) gates this route: no `kinora_session`
 * cookie → redirect to `/login`. If you can see this page you are
 * authenticated (cookie present — full session validation delegated
 * to the API, 05b owns 401/403 reject policy).
 */
export default function DashboardPage() {
  return (
    <main style={mainStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>Dashboard</h1>
        <p style={textStyle}>You are authenticated.</p>

        <form action={logoutAction}>
          <button type="submit" style={buttonStyle}>
            Log out
          </button>
        </form>
      </div>
    </main>
  );
}

const mainStyle: React.CSSProperties = {
  maxWidth: "100%",
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "2rem 1rem",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "24rem",
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
  textAlign: "center",
};

const titleStyle: React.CSSProperties = {
  fontSize: "1.75rem",
  margin: 0,
};

const textStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "1rem",
  color: "#555",
};

const buttonStyle: React.CSSProperties = {
  padding: "0.75rem 1.5rem",
  fontSize: "1rem",
  fontWeight: 600,
  color: "#fff",
  backgroundColor: "#dc2626",
  border: "none",
  borderRadius: "0.5rem",
  cursor: "pointer",
};
