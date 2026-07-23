import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDbClient } from "./client.js";
import { backfillTenantBillingStates } from "./repositories/billing-backfill.js";

async function runCli(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(__dirname, "../../../../.env");
  config({ path: envPath });

  const { db, pool } = createDbClient();
  try {
    const result = await backfillTenantBillingStates(db);
    console.log(
      `[backfill-billing-plans] missing=${result.scannedMissing} inserted=${result.inserted} skippedExisting=${result.skippedExisting}`,
    );
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli().catch((err) => {
    console.error("[backfill-billing-plans] failed:", err);
    process.exitCode = 1;
  });
}
