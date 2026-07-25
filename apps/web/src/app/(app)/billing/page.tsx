import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { BillingPageClient } from "./BillingPageClient";
import { getBillingInvoices, getBillingPricing, getBillingVisibility } from "./billing-client";

export default async function BillingPage() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  // Server-side fetch of every billing surface in parallel. Prices come from
  // config (GET /billing/pricing) and invoices/ownership from the owner-only
  // GET /billing/invoices (a 403 → `forbidden` = non-owner). The session token
  // is read here and never crosses into the client bundle.
  const [visibility, pricing, invoices] = await Promise.all([
    getBillingVisibility(token),
    getBillingPricing(token),
    getBillingInvoices(token),
  ]);

  const initialData = visibility.kind === "ok" ? visibility.data : null;
  const initialError = visibility.kind === "error" ? visibility.message : null;
  const initialPricing = pricing.kind === "ok" ? pricing.data : null;

  return (
    <div className="kin-billing-page" style={{ width: "100%", padding: "1.5rem 1rem" }}>
      <BillingPageClient
        initialData={initialData}
        initialError={initialError}
        pricing={initialPricing}
        initialInvoices={invoices}
      />
    </div>
  );
}
