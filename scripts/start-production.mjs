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

function composeArgs(projectName, ...subcommand) {
  return ["compose", "-p", projectName, ...subcommand];
}

export function planSteps({ env = process.env } = {}) {
  const projectName = resolveComposeProjectName(env.COMPOSE_PROJECT_NAME);
  const postgresUser = env.POSTGRES_USER?.trim() || DEFAULT_POSTGRES_USER;
  const postgresDb = env.POSTGRES_DB?.trim() || DEFAULT_POSTGRES_DB;

  return {
    projectName,
    postgresUser,
    postgresDb,
    steps: [
      {
        label: "ensure-postgres",
        args: composeArgs(projectName, "up", "-d", "postgres"),
      },
      {
        label: "wait-for-postgres",
        args: composeArgs(projectName, "exec", "-T", "postgres", "pg_isready", "-U", postgresUser, "-d", postgresDb),
        retry: { attempts: 30, delayMs: 2000 },
      },
      {
        label: "start-services",
        args: composeArgs(projectName, "up", "-d", "api", "web"),
      },
    ],
  };
}

function sleep(delayMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function runStep({ label, args, retry }) {
  const attempts = retry?.attempts ?? 1;
  const delayMs = retry?.delayMs ?? 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync("docker", args, { stdio: "inherit" });

    if (result.status === 0) return;

    if (attempt === attempts) {
      throw new Error(
        `${label} failed after ${attempts} attempt${attempts === 1 ? "" : "s"}\n` +
          `  Command: docker ${args.join(" ")}\n` +
          `  Exit code: ${result.status}`
      );
    }

    sleep(delayMs);
  }
}

export function startProduction({ env = process.env } = {}) {
  const { steps } = planSteps({ env });

  for (const step of steps) {
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
