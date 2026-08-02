import { describe, it, expect, vi } from "vitest";
import {
  searchTenants,
  fetchTenantOverrideStatus,
  grantTierOverride,
  revokeTierOverride,
} from "../tenant-provisioning-client.js";

const TENANT_ID = "bbbbbbbb-0000-0000-0000-000000000001";

function buildFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

describe("searchTenants", () => {
  it("returns ok with the tenant list on 200", async () => {
    const fetchMock = buildFetch(200, { tenants: [{ id: TENANT_ID, name: "Acme" }] });
    const result = await searchTenants("tok", "acme", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.tenants).toEqual([{ id: TENANT_ID, name: "Acme" }]);
  });

  it("returns forbidden on 403 and invalid on 422", async () => {
    expect(
      (
        await searchTenants("t", "x", {
          apiBaseUrl: "http://api",
          fetchImpl: buildFetch(403, {}) as never,
        })
      ).kind,
    ).toBe("forbidden");
    expect(
      (
        await searchTenants("t", "  ", {
          apiBaseUrl: "http://api",
          fetchImpl: buildFetch(422, {}) as never,
        })
      ).kind,
    ).toBe("invalid");
  });

  it("url-encodes the query and sends the Bearer token", async () => {
    const fetchMock = buildFetch(200, { tenants: [] });
    await searchTenants("my-token", "a b", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api/admin/tenants?query=a%20b");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer my-token");
  });
});

describe("fetchTenantOverrideStatus", () => {
  it("returns ok with the status body on 200", async () => {
    const status = {
      tenant: { id: TENANT_ID, name: "Acme" },
      effectiveTier: "gym",
      billingStatus: "active",
      activeOverride: null,
    };
    const result = await fetchTenantOverrideStatus("tok", TENANT_ID, {
      apiBaseUrl: "http://api",
      fetchImpl: buildFetch(200, status) as never,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.status.effectiveTier).toBe("gym");
  });

  it("returns not_found on 404 and forbidden on 403", async () => {
    expect(
      (
        await fetchTenantOverrideStatus("t", TENANT_ID, {
          apiBaseUrl: "http://api",
          fetchImpl: buildFetch(404, {}) as never,
        })
      ).kind,
    ).toBe("not_found");
    expect(
      (
        await fetchTenantOverrideStatus("t", TENANT_ID, {
          apiBaseUrl: "http://api",
          fetchImpl: buildFetch(403, {}) as never,
        })
      ).kind,
    ).toBe("forbidden");
  });
});

describe("grantTierOverride", () => {
  it("POSTs the grant body and returns ok on 201", async () => {
    const fetchMock = buildFetch(201, { id: "o1" });
    const result = await grantTierOverride(
      "tok",
      TENANT_ID,
      { tier: "gym", reason: "pilot" },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );
    expect(result.kind).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://api/admin/tenants/${TENANT_ID}/tier-override`);
    expect(init.method).toBe("POST");
    const parsed = JSON.parse(init.body as string) as { tier: string; reason: string };
    expect(parsed).toEqual({ tier: "gym", reason: "pilot" });
  });

  it("includes the operationKey in the POST body when provided (#313)", async () => {
    const fetchMock = buildFetch(201, { id: "o1" });
    await grantTierOverride(
      "tok",
      TENANT_ID,
      { tier: "trainer", reason: "pilot", operationKey: "op-key-123" },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(init.body as string) as { operationKey?: string };
    expect(parsed.operationKey).toBe("op-key-123");
  });

  it("maps 409 to conflict and 404 to not_found", async () => {
    expect(
      (
        await grantTierOverride(
          "t",
          TENANT_ID,
          { tier: "gym", reason: "x" },
          { apiBaseUrl: "http://api", fetchImpl: buildFetch(409, {}) as never },
        )
      ).kind,
    ).toBe("conflict");
    expect(
      (
        await grantTierOverride(
          "t",
          TENANT_ID,
          { tier: "gym", reason: "x" },
          { apiBaseUrl: "http://api", fetchImpl: buildFetch(404, {}) as never },
        )
      ).kind,
    ).toBe("not_found");
  });
});

describe("revokeTierOverride", () => {
  it("POSTs to the revoke path and returns ok on 200", async () => {
    const fetchMock = buildFetch(200, { id: "o1" });
    const result = await revokeTierOverride("tok", TENANT_ID, {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });
    expect(result.kind).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://api/admin/tenants/${TENANT_ID}/tier-override/revoke`);
    expect(init.method).toBe("POST");
  });

  it("maps 409 to conflict", async () => {
    const result = await revokeTierOverride("t", TENANT_ID, {
      apiBaseUrl: "http://api",
      fetchImpl: buildFetch(409, {}) as never,
    });
    expect(result.kind).toBe("conflict");
  });
});
