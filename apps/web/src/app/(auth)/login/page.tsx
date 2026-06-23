import { loginAction } from "./actions";

/**
 * Login page — email/password form + "Sign in with Google" link.
 *
 * On submit, the form posts to the `loginAction` Server Action which calls
 * the API `POST /auth/login`, stores the opaque session token in the
 * `kinora_session` cookie, and redirects to the app home. The Google link
 * hits the web social-login proxy (`/auth/social/login?provider=google`)
 * which redirects the user-agent to Google's OIDC authorization URL.
 *
 * Styled with inline styles to match the existing home-page pattern (the
 * web app has no design-system component package yet). UI copy is English
 * by default per the project convention.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const params = await searchParams;
  const error =
    typeof params.error === "string"
      ? params.error
      : Array.isArray(params.error)
        ? (params.error[0] ?? null)
        : null;

  return (
    <main style={mainStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>Log in</h1>

        {error ? (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        ) : null}

        <form action={loginAction} style={formStyle}>
          <label style={labelStyle}>
            <span style={labelTextStyle}>Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              style={inputStyle}
            />
          </label>

          <label style={labelStyle}>
            <span style={labelTextStyle}>Password</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              style={inputStyle}
            />
          </label>

          <button type="submit" style={primaryButtonStyle}>
            Log in
          </button>
        </form>

        <a
          href="/auth/social/login?provider=google"
          style={googleButtonStyle}
        >
          Sign in with Google
        </a>

        <p style={switchStyle}>
          Don&apos;t have an account?{" "}
          <a href="/sign-up" style={switchLinkStyle}>
            Sign up
          </a>
        </p>
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
  boxSizing: "border-box",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "24rem",
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
};

const titleStyle: React.CSSProperties = {
  fontSize: "1.75rem",
  margin: 0,
  textAlign: "center",
};

const errorStyle: React.CSSProperties = {
  margin: 0,
  padding: "0.75rem 1rem",
  borderRadius: "0.5rem",
  backgroundColor: "#fee2e2",
  color: "#b91c1c",
  fontSize: "0.875rem",
};

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
};

const labelTextStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  padding: "0.625rem 0.75rem",
  fontSize: "1rem",
  borderRadius: "0.5rem",
  border: "1px solid #d1d5db",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "0.75rem 1.5rem",
  fontSize: "1rem",
  fontWeight: 600,
  color: "#fff",
  backgroundColor: "#0070f3",
  border: "none",
  borderRadius: "0.5rem",
  cursor: "pointer",
};

const googleButtonStyle: React.CSSProperties = {
  display: "inline-block",
  textAlign: "center",
  padding: "0.75rem 1.5rem",
  fontSize: "1rem",
  fontWeight: 600,
  color: "#111827",
  backgroundColor: "#fff",
  border: "1px solid #d1d5db",
  borderRadius: "0.5rem",
  textDecoration: "none",
};

const switchStyle: React.CSSProperties = {
  margin: 0,
  textAlign: "center",
  fontSize: "0.875rem",
  color: "#555",
};

const switchLinkStyle: React.CSSProperties = {
  color: "#0070f3",
  textDecoration: "none",
  fontWeight: 600,
};
