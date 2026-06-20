import Fastify from "fastify";
import { healthRoute } from "./routes/health.js";

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "0.0.0.0";

async function main() {
  const app = Fastify();

  await app.register(healthRoute);

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
        `Either stop the process using port ${PORT} or set the PORT environment variable to a different port.\n`
      );
      // Do NOT call process.exit — allow the web process to continue running
      return;
    }
    throw err;
  }
}

main();