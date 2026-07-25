import type { InvoiceDTO } from "@kinora/contracts";
import type { InvoiceGateway, StripeInvoiceView } from "./stripe-gateway.js";
import type { BillingCustomerReaderPort } from "./create-portal-session.js";

/**
 * Pure invoice-listing use case (11b-v1-billing-stripe-integration, Slice 4).
 *
 * SDK-free: depends only on the {@link InvoiceGateway} port and a
 * {@link BillingCustomerReaderPort} that resolves the tenant's Stripe customer
 * id from OUR OWN DB. The tenant is passed straight through — the ROUTE resolves
 * it from `authContext`, so a client-supplied tenant/customer can never reach
 * the gateway. There is NO local invoice store: listings are fetched live from
 * Stripe scoped to the tenant's customer, then mapped to a privacy-safe
 * {@link InvoiceDTO}. A tenant with no `stripe_customer_id` (never subscribed)
 * yields the empty state `[]` — NOT an error.
 */

/**
 * Map a Stripe invoice view to the privacy-safe {@link InvoiceDTO}.
 *
 * This is an ALLOWLIST mapping (an explicit field pick, NEVER a spread): only
 * the display-safe fields cross the boundary. It exposes at most the card
 * BRAND and LAST FOUR digits — never a full card number (PAN), CVC, or any
 * other member PII, even if the source object happens to carry extra fields.
 */
export function toInvoiceDTO(view: StripeInvoiceView): InvoiceDTO {
  const dto: InvoiceDTO = {
    id: view.id,
    amountDue: view.amountDue,
    currency: view.currency,
    status: view.status,
    createdAt: new Date(view.created * 1000).toISOString(),
    hostedInvoiceUrl: view.hostedInvoiceUrl,
    receiptUrl: view.receiptUrl,
  };
  // Card display info is OPTIONAL on the DTO — include only when present, and
  // only the brand + last four (never the PAN).
  if (view.cardBrand) dto.cardBrand = view.cardBrand;
  if (view.cardLast4) dto.cardLast4 = view.cardLast4;
  return dto;
}

export interface ListInvoicesInput {
  /** Resolved SERVER-SIDE from `authContext`; NEVER from the request query. */
  tenantId: string;
}

export class ListInvoices {
  constructor(
    private readonly customers: BillingCustomerReaderPort,
    private readonly gateway: InvoiceGateway,
  ) {}

  async execute(input: ListInvoicesInput): Promise<InvoiceDTO[]> {
    const customerId = await this.customers.findStripeCustomerId(input.tenantId);
    // Never-subscribed tenant → empty state, not an error. The gateway is not
    // called (nothing to scope a Stripe list to).
    if (!customerId) {
      return [];
    }
    const views = await this.gateway.listInvoices(customerId);
    return views.map(toInvoiceDTO);
  }
}
