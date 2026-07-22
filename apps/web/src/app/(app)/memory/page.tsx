import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { MemoryPageClient } from "./MemoryPageClient";
import { listUserMemories } from "./memory-client";

export default async function MemoryPage() {
  const t = await getTranslations();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const result = await listUserMemories(token);
  const initialData = result.kind === "ok" ? result.data : null;
  const initialError = result.kind === "error" ? result.message : null;

  return (
    <main className="kin-page">
      <h1 className="kin-title">{t("memory.title")}</h1>
      <p className="kin-text kin-muted" style={{ marginBottom: "1.5rem" }}>
        {t("memory.description")}
      </p>
      <MemoryPageClient initialData={initialData} initialError={initialError} />
    </main>
  );
}
