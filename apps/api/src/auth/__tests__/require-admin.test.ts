import { describe, it, expect, vi } from "vitest";
import { buildRequireAdmin } from "../require-admin.js";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { SessionContext } from "@kinora/contracts";

// --- Helpers ---

function buildRequest(authContext: SessionContext | null): FastifyRequest {
  return { authContext } as unknown as FastifyRequest;
}

function buildReply() {
  const reply = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

function buildUserRepo(isAdmin: boolean | null) {
  return {
    findById: vi.fn().mockResolvedValue(
      isAdmin === null ? null : { id: "user-1", email: "a@b.com", isAdmin }
    ),
  };
}

const SESSION: SessionContext = {
  userId: "user-uuid-1" as never,
  tenantId: "tenant-uuid-1" as never,
  sessionId: "sess-1" as never,
};

// --- Tests ---

describe("requireAdmin", () => {
  it("calls next (no reply.send) when user is admin", async () => {
    const userRepo = buildUserRepo(true);
    const handler = buildRequireAdmin(userRepo as never);
    const request = buildRequest(SESSION);
    const reply = buildReply();

    await handler(request, reply);

    expect(reply.send).not.toHaveBeenCalled();
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("returns 403 when user is not admin", async () => {
    const userRepo = buildUserRepo(false);
    const handler = buildRequireAdmin(userRepo as never);
    const request = buildRequest(SESSION);
    const reply = buildReply();

    await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: "forbidden" });
  });

  it("returns 403 when authContext is null (no session)", async () => {
    const userRepo = buildUserRepo(true);
    const handler = buildRequireAdmin(userRepo as never);
    const request = buildRequest(null);
    const reply = buildReply();

    await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(userRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 403 when user row not found in DB", async () => {
    const userRepo = buildUserRepo(null);
    const handler = buildRequireAdmin(userRepo as never);
    const request = buildRequest(SESSION);
    const reply = buildReply();

    await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: "forbidden" });
  });
});
