import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from the project root (apps/api/src/ → ../../../.env).
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../../../.env");
config({ path: envPath });

import { buildApp } from "./app.js";
import { createDbClient } from "./db/client.js";
import { createProvidersFromEnv } from "./auth/providers.js";
import { createSocialAuthService } from "./auth/social-wiring.js";

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "0.0.0.0";

async function main() {
  // Social login: OIDC providers configured from env (Google first). The
  // database client is created from DATABASE_URL; social login is only wired
  // when a matching provider config is present so unrelated environments keep
  // booting.
  const { db } = createDbClient();
  const registry = createProvidersFromEnv();
  const socialAuthService = createSocialAuthService(db, registry);

  const app = await buildApp(db, socialAuthService);

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`API server listening on http://${HOST}:${PORT}`);
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "EADDRINUSE"
    ) {
      process.stderr.write(
        `Error: Port ${PORT} is already in use. The API server could not start.\n`
      );
      process.stderr.write(
        `Either stop the process using port ${PORT} or set the PORT environment variable to a different value.\n`
      );
      // Do NOT call process.exit — allow the web process to continue running
      return;
    }
    throw err;
  }
}

main();
