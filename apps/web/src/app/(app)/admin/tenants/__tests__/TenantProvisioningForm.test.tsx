// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, cleanup } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";

// The form imports the "use server" actions directly; replace the whole module
// so no Next.js framework glue (next/headers, cookies) runs under Vitest.
const searchTenantsAction = vi.fn();
const fetchStatusAction = vi.fn();
const grantAction = vi.fn();
const revokeAction = vi.fn();
vi.mock("../actions", () => ({
  searchTenantsAction: (...args: unknown[]) => searchTenantsAction(...args),
  fetchStatusAction: (...args: unknown[]) => fetchStatusAction(...args),
  grantAction: (...args: unknown[]) => grantAction(...args),
  revokeAction: (...args: unknown[]) => revokeAction(...args),
}));

import { TenantProvisioningForm } from "../TenantProvisioningForm";

const TENANT = { id: "bbbbbbbb-0000-0000-0000-000000000001", name: "Acme" };
const STATUS = {
  tenant: TENANT,
  effectiveTier: "free",
  billingStatus: null,
  activeOverride: null,
};

/** Search → select a tenant → type a reason so the grant form is ready. */
async function selectTenantAndFillReason() {
  fireEvent.change(screen.getByRole("textbox", { name: "Search tenants" }), {
    target: { value: "acme" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByRole("button", { name: /Acme/ });
  fireEvent.click(screen.getByRole("button", { name: /Acme/ }));
  const reason = await screen.findByRole("textbox", { name: "Reason" });
  fireEvent.change(reason, { target: { value: "pilot program" } });
}

function grantKeyOf(callIndex: number): string {
  const [, input] = grantAction.mock.calls[callIndex] as [string, { operationKey?: string }];
  return input.operationKey ?? "";
}

describe("TenantProvisioningForm — grant idempotency key (#313)", () => {
  beforeEach(() => {
    searchTenantsAction.mockResolvedValue({ kind: "ok", tenants: [TENANT] });
    fetchStatusAction.mockResolvedValue({ kind: "ok", status: STATUS });
    let n = 0;
    vi.spyOn(crypto, "randomUUID").mockImplementation(
      () => `key-${++n}` as `${string}-${string}-${string}-${string}-${string}`,
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("reuses the same key across a retried submit, then a fresh key after success", async () => {
    // First attempt errors, the retry succeeds, a later distinct submit succeeds.
    grantAction
      .mockResolvedValueOnce({ kind: "error", message: "boom" })
      .mockResolvedValue({ kind: "ok" });

    renderWithIntl(<TenantProvisioningForm />);
    await selectTenantAndFillReason();

    const submit = screen.getByRole("button", { name: "Activate tier" });

    // Attempt 1 → error.
    fireEvent.click(submit);
    await waitFor(() => expect(grantAction).toHaveBeenCalledTimes(1));

    // Attempt 2 (retry of the SAME submit) → success. Same key as attempt 1.
    fireEvent.click(screen.getByRole("button", { name: "Activate tier" }));
    await waitFor(() => expect(grantAction).toHaveBeenCalledTimes(2));

    expect(grantKeyOf(0)).toBe("key-1");
    expect(grantKeyOf(1)).toBe("key-1"); // reused across the retry

    // A brand-new submit after a successful grant → a fresh key.
    fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
      target: { value: "second grant" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activate tier" }));
    await waitFor(() => expect(grantAction).toHaveBeenCalledTimes(3));

    expect(grantKeyOf(2)).toBe("key-2"); // distinct from the first operation
  });
});
