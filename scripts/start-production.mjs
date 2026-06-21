import { spawnSync } from "node:child_process";

const DEFAULT_PROJECT_NAME = "kinora";
const DEFAULT_POSTGRES_USER = "kinora";
const DEFAULT_POSTGRES_DB = "kinora";

export function resolveComposeProjectName(value = process.env.COMPOSE_PROJECT_NAME) {
  const projectName = value === undefined ? DEFAULT_PROJECT_NAME : value.trim();

  if (projectName.length === 0) {
    throw new Error("COMPOSE_PROJECT_NAME must not be blank");
  }

  return projectName;
}

export function createProductionStartPlan({ env = process.env } = {}) {
  const projectName = resolveComposeProjectName(env.COMPOSE_PROJECT_NAME);
  const postgresUser = env.POSTGRES_USER?.trim() || DEFAULT_POSTGRES_USER;
  const postgresDb = env.POSTGRES_DB?.trim() || DEFAULT_POSTGRES_DB;
  const composePrefix = ["compose", "-p", projectName];

  return [
    {
      label: "ensure-postgres",
      command: "docker",
      args: [...composePrefix, "up", "-d", "postgres"],
    },
    {
      label: "wait-for-postgres",
      command: "docker",
      args: [
        ...composePrefix,
        "exec",
        "-T",
        "postgres",
        "pg_isready",
        "-U",
        postgresUser,
        "-d",
        postgresDb,
      ],
      retry: { attempts: 30, delayMs: 2000 },
    },
    {
      label: "start-services",
      command: "docker",
      args: [...composePrefix, "up", "-d", "api", "web"],
    },
  ];
}

function sleep(delayMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function runStep(step) {
  const attempts = step.retry?.attempts ?? 1;
  const delayMs = step.retry?.delayMs ?? 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync(step.command, step.args, { stdio: "inherit" });

    if (result.status === 0) {
      return;
    }

    if (attempt === attempts) {
      const commandLine = `${step.command} ${step.args.join(" ")}`;

      throw new Error(
        `${step.label} failed after ${attempts} attempt${attempts === 1 ? "" : "s"}\n` +
          `  Command: ${commandLine}\n` +
          `  Exit code: ${result.status}`
      );
    }

    sleep(delayMs);
  }
}

export function startProduction({ env = process.env } = {}) {
  for (const step of createProductionStartPlan({ env })) {
    runStep(step);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    startProduction();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Production startup failed: ${message}\n`);
    process.exitCode = 1;
  }
}
