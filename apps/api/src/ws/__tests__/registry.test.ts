import { describe, it, expect, vi, beforeEach } from "vitest";
import { WsRegistry } from "../registry.js";

// --- Fake socket factory ---

/**
 * Creates a minimal fake WebSocket socket for testing.
 * - readyState === WebSocket.OPEN (1) by default
 * - Exposes a `send` spy to assert message delivery
 */
function makeFakeSocket(open = true) {
  return {
    readyState: open ? 1 : 3, // 1 = OPEN, 3 = CLOSED
    send: vi.fn(),
  };
}

// --- Tests ---

describe("WsRegistry", () => {
  let registry: WsRegistry;

  beforeEach(() => {
    registry = new WsRegistry();
    vi.clearAllMocks();
  });

  describe("notify — sends only to the matching user's sockets", () => {
    it("calls send on ALL open sockets registered under userId", () => {
      const socketA1 = makeFakeSocket();
      const socketA2 = makeFakeSocket();
      const USER_A = "user-a";

      registry.register(USER_A, socketA1 as never);
      registry.register(USER_A, socketA2 as never);

      const payload = { planId: "plan-1", status: "ready" as const };
      registry.notify(USER_A, payload);

      expect(socketA1.send).toHaveBeenCalledTimes(1);
      expect(socketA1.send).toHaveBeenCalledWith(JSON.stringify(payload));
      expect(socketA2.send).toHaveBeenCalledTimes(1);
      expect(socketA2.send).toHaveBeenCalledWith(JSON.stringify(payload));
    });

    it("does NOT send to sockets registered under a different userId (cross-user isolation)", () => {
      const socketA = makeFakeSocket();
      const socketB = makeFakeSocket();
      const USER_A = "user-a";
      const USER_B = "user-b";

      registry.register(USER_A, socketA as never);
      registry.register(USER_B, socketB as never);

      registry.notify(USER_A, { planId: "plan-1", status: "ready" as const });

      // USER_A's socket received the notification
      expect(socketA.send).toHaveBeenCalledTimes(1);
      // USER_B's socket must NOT receive anything (cross-user isolation)
      expect(socketB.send).not.toHaveBeenCalled();
    });

    it("does nothing when no sockets are registered for userId", () => {
      // Should not throw; simply a no-op
      expect(() => {
        registry.notify("unknown-user", { planId: "plan-1", status: "ready" as const });
      }).not.toThrow();
    });

    it("skips closed/disconnected sockets during notify", () => {
      const openSocket = makeFakeSocket(true);
      const closedSocket = makeFakeSocket(false); // readyState = 3 (CLOSED)
      const USER_A = "user-a";

      registry.register(USER_A, openSocket as never);
      registry.register(USER_A, closedSocket as never);

      registry.notify(USER_A, { planId: "plan-1", status: "failed" as const });

      // Only the open socket receives the message
      expect(openSocket.send).toHaveBeenCalledTimes(1);
      expect(closedSocket.send).not.toHaveBeenCalled();
    });
  });

  describe("unregister — removes socket from the registry", () => {
    it("unregistered socket no longer receives notifications", () => {
      const socket = makeFakeSocket();
      const USER_A = "user-a";

      registry.register(USER_A, socket as never);
      registry.unregister(USER_A, socket as never);

      registry.notify(USER_A, { planId: "plan-1", status: "ready" as const });

      expect(socket.send).not.toHaveBeenCalled();
    });

    it("notify after unregister is a no-op (does not throw)", () => {
      const socket = makeFakeSocket();
      const USER_A = "user-a";

      registry.register(USER_A, socket as never);
      registry.unregister(USER_A, socket as never);

      expect(() => {
        registry.notify(USER_A, { planId: "plan-1", status: "ready" as const });
      }).not.toThrow();
    });

    it("unregistering one socket does not affect other sockets of the same user", () => {
      const socketKeep = makeFakeSocket();
      const socketRemove = makeFakeSocket();
      const USER_A = "user-a";

      registry.register(USER_A, socketKeep as never);
      registry.register(USER_A, socketRemove as never);
      registry.unregister(USER_A, socketRemove as never);

      registry.notify(USER_A, { planId: "plan-1", status: "ready" as const });

      // socketKeep still receives the notification
      expect(socketKeep.send).toHaveBeenCalledTimes(1);
      // socketRemove must not receive anything
      expect(socketRemove.send).not.toHaveBeenCalled();
    });
  });

  describe("cross-tenant isolation", () => {
    it("tenants with different userIds do not receive each other's notifications", () => {
      // Simulate two users from different tenants (different userId strings)
      const socketTenant1 = makeFakeSocket();
      const socketTenant2 = makeFakeSocket();

      // Different users from different tenants have distinct userIds
      registry.register("tenant1:user-1", socketTenant1 as never);
      registry.register("tenant2:user-1", socketTenant2 as never);

      registry.notify("tenant1:user-1", { planId: "plan-1", status: "ready" as const });

      expect(socketTenant1.send).toHaveBeenCalledTimes(1);
      expect(socketTenant2.send).not.toHaveBeenCalled();
    });
  });
});
