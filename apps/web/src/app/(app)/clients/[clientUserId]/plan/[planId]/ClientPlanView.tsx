import { getTranslations } from "next-intl/server";
import type { WorkoutProgram } from "@kinora/contracts";
import type { FetchClientPlanResult } from "../../../trainer-client-types";

export interface ClientPlanViewProps {
  clientUserId: string;
  result: FetchClientPlanResult;
}

/**
 * Read-only trainer view of a client's plan (#341).
 *
 * Deliberately NOT a reuse of `PlanWeekView` / `PlanStatusClient`: both are
 * built for the plan's OWNER. They fetch the caller's own weekly overview,
 * subscribe to the owner's plan websocket, and expose the "Start session" CTA
 * that writes a workout session for the CALLER — a trainer opening a client's
 * plan must not start a session on their own account or read their own
 * progress in the client's context. This view therefore renders the program
 * itself and nothing that mutates.
 *
 * All copy reuses existing catalog keys (`plan.*` / `clients.*`) — no new i18n
 * entries were added for this slice.
 */
export async function ClientPlanView({ clientUserId, result }: ClientPlanViewProps) {
  const t = await getTranslations();

  const backLink = (
    <a href="/clients" className="kin-link">
      {t("clients.navLabel")}
    </a>
  );

  // Authorization outcomes come straight from the API and are rendered as
  // distinct terminal states — never retried and never widened client-side.
  if (result.kind === "forbidden") {
    return (
      <main className="kin-page">
        <h1 className="kin-title">{t("clients.accessRestrictedTitle")}</h1>
        <p className="kin-text kin-muted">{t("clients.accessRestrictedBody")}</p>
        {backLink}
      </main>
    );
  }

  if (result.kind === "notFound") {
    return (
      <main className="kin-page">
        <h1 className="kin-title">{t("plan.nav.empty.title")}</h1>
        <p className="kin-text kin-muted">{t("plan.nav.empty.desc")}</p>
        {backLink}
      </main>
    );
  }

  if (result.kind === "error") {
    return (
      <main className="kin-page">
        <h1 className="kin-title">{t("plan.error.title")}</h1>
        <p className="kin-text kin-muted">{t("clients.loadError")}</p>
        {backLink}
      </main>
    );
  }

  const plan = result.plan;

  // Generation is asynchronous and this view is server-rendered per request
  // (no owner-scoped websocket here — see the doc comment). The trainer sees
  // the generating state and can reload; a completed generation renders the
  // program on the next request.
  if (plan.status === "generating") {
    return (
      <main className="kin-page">
        <h1 className="kin-title">{t("plan.generating.title")}</h1>
        <p className="kin-text kin-muted">{t("plan.generating.desc")}</p>
        <a href={`/clients/${encodeURIComponent(clientUserId)}/plan/${encodeURIComponent(plan.id)}`} className="kin-link">
          {t("clients.retryLabel")}
        </a>
      </main>
    );
  }

  if (plan.status === "failed") {
    return (
      <main className="kin-page">
        <h1 className="kin-title">{t("plan.failed.title")}</h1>
        <p className="kin-text kin-muted">{t("plan.failed.desc")}</p>
        {backLink}
      </main>
    );
  }

  const program = plan.program as WorkoutProgram | undefined;
  const sessions = program?.weeklySessions ?? [];
  const warnings = program?.limitationWarnings ?? [];

  return (
    <main className="kin-page">
      <h1 className="kin-title">{plan.name ?? t("plan.ready.title")}</h1>

      {warnings.length > 0 && (
        <section className="kin-card" aria-label={t("plan.limitation.title")}>
          <h2 className="kin-subtitle">{t("plan.limitation.title")}</h2>
          <ul>
            {warnings.map((warning) => (
              <li key={warning} className="kin-text kin-muted">
                {warning}
              </li>
            ))}
          </ul>
          <p className="kin-text kin-muted">{t("plan.limitation.advisory")}</p>
        </section>
      )}

      {sessions.map((session) => (
        <section key={session.day} className="kin-card">
          <h2 className="kin-subtitle">
            {t("plan.day.label", { n: session.day })} · {session.title}
          </h2>
          <table>
            <thead>
              <tr>
                <th scope="col">{t("plan.table.exercise")}</th>
                <th scope="col">{t("plan.table.sets")}</th>
                <th scope="col">{t("plan.table.reps")}</th>
                <th scope="col">{t("plan.table.rest")}</th>
              </tr>
            </thead>
            <tbody>
              {session.exercises.map((exercise, index) => (
                <tr key={`${session.day}-${index}-${exercise.name}`}>
                  <td>{exercise.name}</td>
                  <td>{exercise.sets}</td>
                  <td>{exercise.reps}</td>
                  <td>{exercise.restSeconds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {backLink}
    </main>
  );
}
