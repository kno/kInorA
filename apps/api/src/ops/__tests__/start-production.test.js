import { describe, expect, it } from "vitest";
import {
  planSteps,
  resolveComposeProjectName,
} from "../../../../../scripts/start-production.mjs";

describe("production startup command planning", () => {
  it("plans PostgreSQL readiness before starting app services", () => {
    const { projectName, steps } = planSteps({ env: { COMPOSE_PROJECT_NAME: "kinora" } });

    expect(projectName).toBe("kinora");
    expect(steps.map((s) => s.label)).toEqual([
      "ensure-postgres",
      "wait-for-postgres",
      "start-services",
    ]);

    expect(steps[0].args).toEqual(["compose", "-p", "kinora", "up", "-d", "postgres"]);
    expect(steps[1].args).toEqual([
      "compose", "-p", "kinora", "exec", "-T", "postgres",
      "pg_isready", "-U", "kinora", "-d", "kinora",
    ]);
    expect(steps[2].args).toEqual(["compose", "-p", "kinora", "up", "-d", "api", "web"]);
  });

  it("uses configured PostgreSQL credentials for readiness checks", () => {
    const { steps } = planSteps({
      env: {
        COMPOSE_PROJECT_NAME: "kinora-prod",
        POSTGRES_USER: "app_user",
        POSTGRES_DB: "app_db",
      },
    });

    const waitStep = steps[1];
    expect(waitStep.args).toContain("app_user");
    expect(waitStep.args).toContain("app_db");
  });

  it("rejects blank Compose project names", () => {
    expect(() => resolveComposeProjectName(" ")).toThrow(
      "COMPOSE_PROJECT_NAME must not be blank"
    );
  });

  it("enforces ordering: postgres → wait → services", () => {
    const { steps } = planSteps({ env: { COMPOSE_PROJECT_NAME: "kinora" } });
    const labels = steps.map((s) => s.label);

    expect(labels.indexOf("ensure-postgres")).toBe(0);
    expect(labels.indexOf("wait-for-postgres")).toBe(1);
    expect(labels.indexOf("start-services")).toBe(2);
  });

  it("includes a bounded retry on the readiness step", () => {
    const { steps } = planSteps({ env: { COMPOSE_PROJECT_NAME: "kinora" } });
    const waitStep = steps.find((s) => s.label === "wait-for-postgres");

    expect(waitStep).toBeDefined();
    expect(waitStep.retry).toBeDefined();
    expect(waitStep.retry.attempts).toBeGreaterThanOrEqual(5);
    expect(waitStep.retry.attempts).toBeLessThanOrEqual(60);
    expect(waitStep.retry.delayMs).toBeGreaterThanOrEqual(500);
    expect(waitStep.retry.delayMs).toBeLessThanOrEqual(5000);
  });

  it("returns project metadata alongside steps", () => {
    const result = planSteps({ env: { COMPOSE_PROJECT_NAME: "kinora" } });

    expect(result).toHaveProperty("projectName");
    expect(result).toHaveProperty("postgresUser");
    expect(result).toHaveProperty("postgresDb");
    expect(result).toHaveProperty("steps");
  });
});
