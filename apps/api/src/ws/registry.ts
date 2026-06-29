/**
 * WsRegistry — in-memory per-user WebSocket connection registry.
 *
 * Single-node v1. Does NOT use Redis or pub/sub — acceptable for v1
 * single-node deployment (documented in design.md architecture decisions).
 *
 * Supports multiple open sockets per user (e.g. multiple browser tabs).
 * Payloads carry ONLY { planId, status } — NO program content, NO health data.
 *
 * Cross-tenant isolation invariant:
 * The registry keys on `userId` alone and does NOT explicitly enforce tenant
 * scoping. This is safe ONLY because session `userId` values are globally-unique
 * UUIDs (assigned at user-creation time, never reused across tenants). A userId
 * from tenant A will never equal a userId from tenant B, so isolation is a
 * natural consequence of UUID uniqueness — not a separate check here.
 */

/** Minimal interface satisfied by WebSocket.WebSocket from the `ws` package. */
export interface WsSocket {
  readonly readyState: number;
  send(data: string): void;
}

/** WebSocket readyState constants (subset from the ws spec). */
const WS_OPEN = 1;

export interface WsPlanStatusPayload {
  planId: string;
  status: "ready" | "failed" | "generating";
}

/**
 * Per-user in-memory registry of open WebSocket connections.
 *
 * register   — associate a socket with a userId
 * unregister — remove a socket when the connection closes
 * notify     — send a payload to ALL open sockets for a userId
 */
export class WsRegistry {
  private readonly sockets = new Map<string, Set<WsSocket>>();

  /**
   * Register a socket under userId. Safe to call multiple times
   * for the same userId (multi-tab scenario).
   */
  register(userId: string, socket: WsSocket): void {
    let set = this.sockets.get(userId);
    if (!set) {
      set = new Set();
      this.sockets.set(userId, set);
    }
    set.add(socket);
  }

  /**
   * Remove a socket from the registry (call on connection close).
   * No-op when the socket is not registered.
   */
  unregister(userId: string, socket: WsSocket): void {
    const set = this.sockets.get(userId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) {
      this.sockets.delete(userId);
    }
  }

  /**
   * Send payload to ALL open sockets for userId.
   *
   * - Skips closed/closing sockets (readyState !== OPEN).
   * - Never throws — fire-and-forget-safe.
   * - Payload is ONLY { planId, status } — no health data, no program content.
   */
  notify(userId: string, payload: WsPlanStatusPayload): void {
    const set = this.sockets.get(userId);
    if (!set) return;

    const message = JSON.stringify(payload);
    for (const socket of set) {
      if (socket.readyState === WS_OPEN) {
        try {
          socket.send(message);
        } catch {
          // Swallow individual socket errors — a broken socket should not
          // prevent notification of other sockets for the same user.
        }
      }
    }
  }
}
