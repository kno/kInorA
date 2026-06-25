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
 * Styled with the kInorA design-system tokens (globals.css). UI copy is
 * English by default per the project convention.
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
    <main className="kin-page">
      <div className="kin-card">
        <h1 className="kin-title kin-title--center">Log in</h1>

        {error ? (
          <p role="alert" className="kin-error">
            {error}
          </p>
        ) : null}

        <form action={loginAction} className="kin-form">
          <label className="kin-field">
            <span className="kin-label">Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="kin-input"
            />
          </label>

          <label className="kin-field">
            <span className="kin-label">Password</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="kin-input"
            />
          </label>

          <button type="submit" className="kin-btn kin-btn--accent">
            Log in
          </button>
        </form>

        <a
          href="/auth/social/login?provider=google"
          className="kin-btn kin-btn--ghost"
        >
          Sign in with Google
        </a>

        <p className="kin-switch">
          Don&apos;t have an account?{" "}
          <a href="/sign-up" className="kin-switch-link">
            Sign up
          </a>
        </p>
      </div>
    </main>
  );
}