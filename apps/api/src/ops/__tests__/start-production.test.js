import { describe, expect, it } from "vitest";
import {
  createProductionStartPlan,
  resolveComposeProjectName,
} from "../../../../../scripts/start-production.mjs";

describe("production startup command planning", () => {
  it("plans PostgreSQL readiness before starting app services", () => {
    const plan = createProductionStartPlan({ env: { COMPOSE_PROJECT_NAME: "kinora" } });

    expect(plan).toEqual([
      {
        label: "ensure-postgres",
        command: "docker",
        args: ["compose", "-p", "kinora", "up", "-d", "postgres"],
      },
      {
        label: "wait-for-postgres",
        command: "docker",
        args: ["compose", "-p", "kinora", "exec", "-T", "postgres", "pg_isready", "-U", "kinora", "-d", "kinora"],
        retry: { attempts: 30, delayMs: 2000 },
      },
      {
        label: "start-services",
        command: "docker",
        args: ["compose", "-p", "kinora", "up", "-d", "api", "web"],
      },
    ]);
  });

  it("uses configured PostgreSQL credentials for readiness checks", () => {
    const plan = createProductionStartPlan({
      env: {
        COMPOSE_PROJECT_NAME: "kinora-prod",
        POSTGRES_USER: "app_user",
        POSTGRES_DB: "app_db",
      },
    });

    expect(plan[1]).toEqual({
      label: "wait-for-postgres",
      command: "docker",
      args: ["compose", "-p", "kinora-prod", "exec", "-T", "postgres", "pg_isready", "-U", "app_user", "-d", "app_db"],
      retry: { attempts: 30, delayMs: 2000 },
    });
  });

  it("rejects blank Compose project names", () => {
    expect(() => resolveComposeProjectName(" ")).toThrow(
      "COMPOSE_PROJECT_NAME must not be blank"
    );
  });

  it("enforces ordering: postgres → wait → services", () => {
    const plan = createProductionStartPlan({ env: { COMPOSE_PROJECT_NAME: "kinora" } });
    const labels = plan.map((s) => s.label);

    const pgIdx = labels.indexOf("ensure-postgres");
    const waitIdx = labels.indexOf("wait-for-postgres");
    const svcIdx = labels.indexOf("start-services");

    expect(pgIdx).not.toBe(-1);
    expect(waitIdx).not.toBe(-1);
    expect(svcIdx).not.toBe(-1);

    expect(pgIdx).toBeLessThan(waitIdx);
    expect(waitIdx).toBeLessThan(svcIdx);
  });

  it("includes a bounded retry on the readiness step", () => {
    const plan = createProductionStartPlan({ env: { COMPOSE_PROJECT_NAME: "kinora" } });
    const waitStep = plan.find((s) => s.label === "wait-for-postgres");

    expect(waitStep).toBeDefined();
    expect(waitStep.retry).toBeDefined();
    expect(waitStep.retry.attempts).toBeGreaterThanOrEqual(5);
    expect(waitStep.retry.attempts).toBeLessThanOrEqual(60);
    expect(waitStep.retry.delayMs).toBeGreaterThanOrEqual(500);
    expect(waitStep.retry.delayMs).toBeLessThanOrEqual(5000);
  });
});
