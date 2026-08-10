"use client";

import { useFormStatus } from "react-dom";

interface AuthSubmitButtonProps {
  /** Label in the idle state — `auth.login.submit` / `auth.signup.submit`. */
  children: string;
  /** Label while the Server Action is in flight — the screens' "Comprobando…". */
  pendingLabel: string;
  /**
   * The module's `.submit` class; also the `:has()` hook for the pending
   * state. Typed as optional-string because that is what a CSS-module lookup
   * resolves to — a missing class must not become a type error at the call
   * site, the same way `className` itself accepts `undefined`.
   */
  className: string | undefined;
  /** The module's `.spinner` class. */
  spinnerClassName: string | undefined;
}

/**
 * Submit button for the login and sign-up forms (kno/kInorA#445).
 *
 * The Open Design screens draw an explicit submitting state — spinner, a
 * "Comprobando…" / "Creando cuenta…" label, and the rest of the form greyed
 * out (`web-login.html:217`, `web-sign-up.html:240`). `useFormStatus` is the
 * only way to know a `<form action={serverAction}>` is in flight, and it must
 * run on the client, so this button is the ONE client component under
 * `(auth)/`. Both pages stay server components.
 *
 * It changes no behaviour: the form still posts to the same Server Action, the
 * button is still a plain `type="submit"`, and nothing here decides whether
 * the submission happens. `data-pending` is published so the module stylesheet
 * can carry the state to the sibling inputs and the Google button via
 * `:has()`, which keeps the fields themselves server-rendered.
 *
 * `aria-busy` announces the wait; `disabled` prevents a double submission,
 * which the browser's own default form handling does not.
 */
export function AuthSubmitButton({
  children,
  pendingLabel,
  className,
  spinnerClassName,
}: AuthSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      aria-busy={pending}
      data-pending={pending ? "" : undefined}
    >
      {pending ? (
        <>
          <span className={spinnerClassName} aria-hidden="true" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export default AuthSubmitButton;
