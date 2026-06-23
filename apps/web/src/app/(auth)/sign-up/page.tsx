import { signupAction } from "./actions";

/**
 * Sign-up page — email/password form + "Sign up with Google" link.
 *
 * On submit, the form posts to the `signupAction` Server Action which calls
 * the API `POST /auth/register`, stores the session token, and redirects
 * home. The Google link hits the social-login proxy. Mirrors the login page
 * layout and styling.
 */
export default async function SignUpPage({
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
        <h1 style={titleStyle}>Sign up</h1>

        {error ? (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        ) : null}

        <form action={signupAction} style={formStyle}>
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
              autoComplete="new-password"
              style={inputStyle}
            />
          </label>

          <button type="submit" style={primaryButtonStyle}>
            Sign up
          </button>
        </form>

        <a
          href="/auth/social/login?provider=google"
          style={googleButtonStyle}
        >
          Sign up with Google
        </a>

        <p style={switchStyle}>
          Already have an account?{" "}
          <a href="/login" style={switchLinkStyle}>
            Log in
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
