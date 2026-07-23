import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { BillingPageClient } from "./BillingPageClient";
import { getBillingVisibility } from "./billing-client";

export default async function BillingPage() {
  const t = await getTranslations();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const result = await getBillingVisibility(token);
  const initialData = result.kind === "ok" ? result.data : null;
  const initialError = result.kind === "error" ? result.message : null;

  return (
    <main className="kin-page">
      <h1 className="kin-title">{t("billing.title")}</h1>
      <p className="kin-text kin-muted" style={{ marginBottom: "1.5rem" }}>
        {t("billing.description")}
      </p>
      <BillingPageClient initialData={initialData} initialError={initialError} />
    </main>
  );
}
