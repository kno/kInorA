import { describe, it, expect, vi } from "vitest";
import { fetchBranding, updateBranding, uploadLogo } from "../branding-client.js";

const DTO = {
  tenantId: "aaaaaaaa-0000-0000-0000-000000000001",
  subdomainSlug: "acme-gym",
  logoUrl: "/media/branding/key-1",
  palette: {
    accent: "#c4f542",
    accentFg: "#0a0a0b",
    surface: null,
    surface2: null,
    fg: null,
    muted: null,
  },
};

function buildFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

describe("fetchBranding", () => {
  it("returns ok with the branding DTO on 200 and sends the Bearer token", async () => {
    const fetchMock = buildFetch(200, DTO);
    const result = await fetchBranding("tok", { apiBaseUrl: "http://api", fetchImpl: fetchMock as never });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.branding).toEqual(DTO);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api/branding");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
  });

  it("maps 403 to forbidden, 401 to unauthorized, 404 to not_found", async () => {
    expect((await fetchBranding("t", { apiBaseUrl: "http://api", fetchImpl: buildFetch(403, {}) as never })).kind).toBe("forbidden");
    expect((await fetchBranding("t", { apiBaseUrl: "http://api", fetchImpl: buildFetch(401, {}) as never })).kind).toBe("unauthorized");
    expect((await fetchBranding("t", { apiBaseUrl: "http://api", fetchImpl: buildFetch(404, {}) as never })).kind).toBe("not_found");
  });

  it("maps an unexpected status and a network error to error", async () => {
    expect((await fetchBranding("t", { apiBaseUrl: "http://api", fetchImpl: buildFetch(500, {}) as never })).kind).toBe("error");
    const boom = vi.fn().mockRejectedValue(new Error("down"));
    expect((await fetchBranding("t", { apiBaseUrl: "http://api", fetchImpl: boom as never })).kind).toBe("error");
  });
});

describe("updateBranding", () => {
  it("PUTs the subdomainSlug + palette body and returns ok with the updated DTO on 200", async () => {
    const fetchMock = buildFetch(200, DTO);
    const result = await updateBranding(
      "tok",
      { subdomainSlug: "acme-gym", palette: DTO.palette },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.branding.subdomainSlug).toBe("acme-gym");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api/branding");
    expect(init.method).toBe("PUT");
    const parsed = JSON.parse(init.body as string) as { subdomainSlug: string; palette: unknown };
    expect(parsed).toEqual({ subdomainSlug: "acme-gym", palette: DTO.palette });
  });

  it("maps 409 to conflict, 400 and 422 to invalid", async () => {
    const body = { subdomainSlug: "x", palette: DTO.palette };
    expect((await updateBranding("t", body, { apiBaseUrl: "http://api", fetchImpl: buildFetch(409, {}) as never })).kind).toBe("conflict");
    expect((await updateBranding("t", body, { apiBaseUrl: "http://api", fetchImpl: buildFetch(400, {}) as never })).kind).toBe("invalid");
    expect((await updateBranding("t", body, { apiBaseUrl: "http://api", fetchImpl: buildFetch(422, {}) as never })).kind).toBe("invalid");
  });

  it("maps 401 to unauthorized and 403 to forbidden", async () => {
    const body = { subdomainSlug: "x", palette: DTO.palette };
    expect((await updateBranding("t", body, { apiBaseUrl: "http://api", fetchImpl: buildFetch(401, {}) as never })).kind).toBe("unauthorized");
    expect((await updateBranding("t", body, { apiBaseUrl: "http://api", fetchImpl: buildFetch(403, {}) as never })).kind).toBe("forbidden");
  });
});

describe("uploadLogo", () => {
  function fakeFile() {
    return new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
  }

  it("POSTs multipart form-data and returns ok with the logoUrl on 200", async () => {
    const fetchMock = buildFetch(200, { logoUrl: "/media/branding/new-key" });
    const result = await uploadLogo("tok", fakeFile(), { apiBaseUrl: "http://api", fetchImpl: fetchMock as never });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.logoUrl).toBe("/media/branding/new-key");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api/branding/logo");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
  });

  it("maps 413 to too_large, 415 to unsupported, 400 to invalid, 403 to forbidden", async () => {
    expect((await uploadLogo("t", fakeFile(), { apiBaseUrl: "http://api", fetchImpl: buildFetch(413, {}) as never })).kind).toBe("too_large");
    expect((await uploadLogo("t", fakeFile(), { apiBaseUrl: "http://api", fetchImpl: buildFetch(415, {}) as never })).kind).toBe("unsupported");
    expect((await uploadLogo("t", fakeFile(), { apiBaseUrl: "http://api", fetchImpl: buildFetch(400, {}) as never })).kind).toBe("invalid");
    expect((await uploadLogo("t", fakeFile(), { apiBaseUrl: "http://api", fetchImpl: buildFetch(403, {}) as never })).kind).toBe("forbidden");
  });
});
