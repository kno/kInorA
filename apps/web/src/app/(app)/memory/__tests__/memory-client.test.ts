import { describe, expect, it, vi } from "vitest";
import type {
  CreateUserMemoryRequest,
  ListUserMemoriesResponse,
  MemorySettings,
  UpdateMemorySettingsRequest,
  UserMemory,
} from "@kinora/contracts";
import {
  createUserMemory,
  deleteUserMemory,
  listUserMemories,
  updateMemorySettings,
} from "../memory-client";

const OPTIONS = { apiBaseUrl: "http://api.test" };
const TOKEN = "session-tok";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const settings: MemorySettings = {
  tenantId: "tenant-1" as never,
  userId: "user-1" as never,
  enabled: true,
  settingsVersion: 2,
  disabledAt: null,
  updatedAt: "2026-07-22T12:00:00.000Z",
};

const memory: UserMemory = {
  id: "memory-1",
  tenantId: "tenant-1" as never,
  userId: "user-1" as never,
  summary: "Prefers morning workouts",
  source: "user_confirmation",
  status: "active",
  eligibility: "eligible",
  consentStatus: "granted",
  consentedAt: "2026-07-22T12:00:00.000Z",
  revokedAt: null,
  disabledAt: null,
  deletedAt: null,
  idempotencyKey: "idem-1",
  fingerprint: "fp-1",
  schemaVersion: "10b-v1",
  embeddingProvider: "openai",
  embeddingModel: "text-embedding-3-small",
  embeddingVersion: "text-embedding-3-small",
  embeddingDimension: 1536,
  createdAt: "2026-07-22T12:00:00.000Z",
  updatedAt: "2026-07-22T12:00:00.000Z",
};

const listResponse: ListUserMemoriesResponse = { settings, memories: [memory] };
const createInput: CreateUserMemoryRequest = {
  factText: "Prefers morning workouts",
  source: "user_confirmation",
  idempotencyKey: "idem-1",
};
const settingsInput: UpdateMemorySettingsRequest = { enabled: false };

describe("listUserMemories", () => {
  it("uses API_BASE_URL when no explicit API base is supplied", async () => {
    const previousBaseUrl = process.env.API_BASE_URL;
    process.env.API_BASE_URL = "http://env-api.test";
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { settings, memories: [] }));

    try {
      await listUserMemories(TOKEN, { fetchImpl });
      expect(fetchImpl).toHaveBeenCalledWith(
        "http://env-api.test/user-memories",
        expect.any(Object),
      );
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = previousBaseUrl;
      }
    }
  });

  it("constructs the authenticated GET request and returns the response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, listResponse));

    const result = await listUserMemories(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", data: listResponse });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/user-memories",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: "Bearer session-tok" },
        cache: "no-store",
      }),
    );
  });

  it("returns the API error and does not leak malformed success payloads", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: "server_error" }));

    await expect(listUserMemories(TOKEN, { ...OPTIONS, fetchImpl })).resolves.toEqual({
      kind: "error",
      message: "server_error",
    });
    await expect(
      listUserMemories(TOKEN, {
        ...OPTIONS,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, { memories: [] })),
      }),
    ).resolves.toEqual({ kind: "error", message: "invalid_response" });
  });

  it("returns no_session and api_unreachable without throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(listUserMemories(undefined, { ...OPTIONS, fetchImpl })).resolves.toEqual({
      kind: "error",
      message: "no_session",
    });
    await expect(listUserMemories(TOKEN, { ...OPTIONS, fetchImpl })).resolves.toEqual({
      kind: "error",
      message: "api_unreachable",
    });
  });
});

describe("createUserMemory", () => {
  it("constructs the authenticated JSON POST request and returns the created memory", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { memory }));

    const result = await createUserMemory(TOKEN, createInput, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", data: { memory } });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/user-memories",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer session-tok",
          "content-type": "application/json",
        },
        body: JSON.stringify(createInput),
      }),
    );
  });

  it("maps validation, API, network, and malformed success responses", async () => {
    const cases = [
      [422, { error: "memory_ineligible" }, { kind: "validation_error", message: "memory_ineligible" }],
      [400, { error: "bad_request" }, { kind: "error", message: "bad_request" }],
      [200, {}, { kind: "error", message: "invalid_response" }],
    ] as const;

    for (const [status, body, expected] of cases) {
      await expect(
        createUserMemory(TOKEN, createInput, {
          ...OPTIONS,
          fetchImpl: vi.fn().mockResolvedValue(jsonResponse(status, body)),
        }),
      ).resolves.toEqual(expected);
    }

    await expect(
      createUserMemory(TOKEN, createInput, {
        ...OPTIONS,
        fetchImpl: vi.fn().mockRejectedValue(new Error("network down")),
      }),
    ).resolves.toEqual({ kind: "error", message: "api_unreachable" });
  });
});

describe("deleteUserMemory", () => {
  it("constructs the authenticated DELETE request and returns confirmation", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { deleted: true }));

    const result = await deleteUserMemory(TOKEN, "memory-1", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", data: { deleted: true } });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/user-memories/memory-1",
      expect.objectContaining({
        method: "DELETE",
        headers: { authorization: "Bearer session-tok" },
      }),
    );
  });

  it("returns API, network, and invalid-response errors", async () => {
    await expect(
      deleteUserMemory(TOKEN, "memory-1", {
        ...OPTIONS,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(404, { error: "not_found" })),
      }),
    ).resolves.toEqual({ kind: "error", message: "not_found" });
    await expect(
      deleteUserMemory(TOKEN, "memory-1", {
        ...OPTIONS,
        fetchImpl: vi.fn().mockRejectedValue(new Error("network down")),
      }),
    ).resolves.toEqual({ kind: "error", message: "api_unreachable" });
    await expect(
      deleteUserMemory(TOKEN, "memory-1", {
        ...OPTIONS,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, { deleted: false })),
      }),
    ).resolves.toEqual({ kind: "error", message: "invalid_response" });
  });
});

describe("updateMemorySettings", () => {
  it("constructs the authenticated JSON PATCH request and returns settings", async () => {
    const updatedSettings = { ...settings, enabled: false, settingsVersion: 3 };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, updatedSettings));

    const result = await updateMemorySettings(TOKEN, settingsInput, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", data: updatedSettings });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/user-memories/settings",
      expect.objectContaining({
        method: "PATCH",
        headers: {
          authorization: "Bearer session-tok",
          "content-type": "application/json",
        },
        body: JSON.stringify(settingsInput),
      }),
    );
  });

  it("returns API, network, and malformed-response errors", async () => {
    await expect(
      updateMemorySettings(TOKEN, settingsInput, {
        ...OPTIONS,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" })),
      }),
    ).resolves.toEqual({ kind: "error", message: "forbidden" });
    await expect(
      updateMemorySettings(TOKEN, settingsInput, {
        ...OPTIONS,
        fetchImpl: vi.fn().mockRejectedValue(new Error("network down")),
      }),
    ).resolves.toEqual({ kind: "error", message: "api_unreachable" });
    await expect(
      updateMemorySettings(TOKEN, settingsInput, {
        ...OPTIONS,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, { enabled: false })),
      }),
    ).resolves.toEqual({ kind: "error", message: "invalid_response" });
  });
});
