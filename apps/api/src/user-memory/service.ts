import { createHash } from "node:crypto";
import type {
  BillingDenialReason,
  BillingFeature,
  CreateUserMemoryRequest,
  ListUserMemoriesResponse,
  MemorySettings,
  UserMemory,
} from "@kinora/contracts";
import type { EmbeddingFailureReason } from "../ai/embedding-port.js";
import type { ConsumeDecision } from "../billing/types.js";
import type {
  PersistVectorMemoryInput,
  PersistVectorMemoryResult,
} from "../ai/memory-retriever.js";
import { classifyMemoryEligibility } from "./eligibility.js";

type MemoryScope = { tenantId: string; userId: string };

/**
 * Billing gate for the cost-bearing premium memory WRITE (11a). Injected into
 * the lifecycle service so the `memory_write` unit is checked+consumed at the
 * exact point a write becomes cost-bearing: AFTER eligibility + enabled pass
 * and JUST BEFORE embed+store. This guarantees (a) an entitlement/quota denial
 * still blocks before any embedding cost, and (b) an ineligible or disabled
 * write — which stores nothing — never consumes a unit. Optional: when absent
 * the service does not gate (test seam; production always wires the real gate).
 */
export interface MemoryWriteBillingGate {
  checkAndConsume(
    scope: MemoryScope,
    feature: BillingFeature,
    operationKey: string,
  ): Promise<ConsumeDecision>;
}

type UserMemoryRepositoryPort = {
  listByOwner(scope: MemoryScope): Promise<unknown[]>;
  getSettings(scope: MemoryScope): Promise<unknown | null>;
  setEnabled(scope: MemoryScope, enabled: boolean): Promise<unknown>;
  delete(scope: MemoryScope, id: string): Promise<{ kind: "deleted" | "not_found" }>;
};

type UserMemoryWriterPort = {
  saveConfirmedMemory(
    scope: MemoryScope,
    input: PersistVectorMemoryInput,
  ): Promise<PersistVectorMemoryResult>;
};

export interface UserMemoryAuditEvent {
  operation: "list" | "create" | "delete" | "settings";
  outcome:
    | "listed"
    | "stored"
    | "rejected"
    | "failed"
    | "denied"
    | "deleted"
    | "not_found"
    | "enabled"
    | "disabled";
  tenantId: string;
  userId: string;
  reason?: string;
  memoryId?: string;
  count?: number;
}

export interface UserMemoryAuditPort {
  record(event: UserMemoryAuditEvent): Promise<void> | void;
}

export type UserMemoryCreateOutcome =
  | { kind: "stored"; memory: UserMemory }
  | { kind: "rejected"; reason: UserMemory["eligibility"] }
  | { kind: "denied"; reason: BillingDenialReason }
  | { kind: "failed"; reason: EmbeddingFailureReason | "disabled" };

const SCHEMA_VERSION = "1";
export class UserMemoryLifecycleService {
  constructor(
    private readonly repo: UserMemoryRepositoryPort,
    private readonly writer: UserMemoryWriterPort,
    private readonly audit: UserMemoryAuditPort,
    private readonly billing?: MemoryWriteBillingGate,
  ) {}

  async listForOwner(scope: MemoryScope): Promise<ListUserMemoriesResponse> {
    const [settingsRow, memoryRows] = await Promise.all([
      this.repo.getSettings(scope),
      this.repo.listByOwner(scope),
    ]);
    const response = {
      settings: settingsRow ? toSettingsDTO(settingsRow) : defaultSettings(scope),
      memories: memoryRows.map((row) => toMemoryDTO(row)),
    } satisfies ListUserMemoriesResponse;

    await this.audit.record({
      operation: "list",
      outcome: "listed",
      tenantId: scope.tenantId,
      userId: scope.userId,
      count: response.memories.length,
    });

    return response;
  }

  async createConfirmed(
    scope: MemoryScope,
    request: CreateUserMemoryRequest,
  ): Promise<UserMemoryCreateOutcome> {
    const summary = normalizeFactText(request.factText);
    const eligibility = classifyEligibility(summary);
    if (eligibility !== "eligible") {
      await this.audit.record({
        operation: "create",
        outcome: "rejected",
        tenantId: scope.tenantId,
        userId: scope.userId,
        reason: eligibility,
      });
      return { kind: "rejected", reason: eligibility };
    }

    const settingsRow = await this.repo.getSettings(scope);
    const settings = settingsRow ? toSettingsDTO(settingsRow) : defaultSettings(scope);
    if (!settings.enabled) {
      await this.audit.record({
        operation: "create",
        outcome: "failed",
        tenantId: scope.tenantId,
        userId: scope.userId,
        reason: "disabled",
      });
      return { kind: "failed", reason: "disabled" };
    }

    // 11a billing: consume the `memory_write` unit HERE — after eligibility +
    // enabled pass (so a rejected/disabled write, which stores nothing, spends
    // nothing) and JUST BEFORE embed+store (so an entitlement/quota denial still
    // blocks before any embedding cost). A gate technical error propagates
    // (→ 500): the write path fails CLOSED, never bypassing the check. The
    // operation key is the request's own idempotency key, so a legitimate
    // same-fact retry replays the prior decision and consumes at most once.
    if (this.billing) {
      const decision = await this.billing.checkAndConsume(
        scope,
        "memory_write",
        `memory_write:${request.idempotencyKey.trim()}`,
      );
      if (!decision.allowed) {
        await this.audit.record({
          operation: "create",
          outcome: "denied",
          tenantId: scope.tenantId,
          userId: scope.userId,
          reason: decision.reason,
        });
        return { kind: "denied", reason: decision.reason };
      }
    }

    const result = await this.writer.saveConfirmedMemory(scope, {
      summary,
      source: request.source,
      status: "active",
      eligibility: "eligible",
      consentStatus: "granted",
      consentedAt: new Date(),
      idempotencyKey: request.idempotencyKey.trim(),
      fingerprint: fingerprint(scope, summary),
      schemaVersion: SCHEMA_VERSION,
    });

    if (result.kind === "rejected") {
      await this.audit.record({
        operation: "create",
        outcome: "rejected",
        tenantId: scope.tenantId,
        userId: scope.userId,
        reason: result.reason,
      });
      return result;
    }

    if (result.kind === "failed") {
      await this.audit.record({
        operation: "create",
        outcome: "failed",
        tenantId: scope.tenantId,
        userId: scope.userId,
        reason: result.reason,
      });
      return result;
    }

    const memory = toMemoryDTO(result.record);
    await this.audit.record({
      operation: "create",
      outcome: "stored",
      tenantId: scope.tenantId,
      userId: scope.userId,
      memoryId: memory.id,
    });
    return { kind: "stored", memory };
  }

  async deleteMemory(
    scope: MemoryScope,
    id: string,
  ): Promise<{ kind: "deleted" | "not_found" }> {
    const result = await this.repo.delete(scope, id);
    await this.audit.record({
      operation: "delete",
      outcome: result.kind,
      tenantId: scope.tenantId,
      userId: scope.userId,
      memoryId: id,
    });
    return result;
  }

  async setEnabled(scope: MemoryScope, enabled: boolean): Promise<MemorySettings> {
    const settings = toSettingsDTO(await this.repo.setEnabled(scope, enabled));
    await this.audit.record({
      operation: "settings",
      outcome: enabled ? "enabled" : "disabled",
      tenantId: scope.tenantId,
      userId: scope.userId,
    });
    return settings;
  }
}

export function normalizeFactText(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export function classifyEligibility(input: string): UserMemory["eligibility"] {
  return classifyMemoryEligibility(input);
}

export const consoleUserMemoryAuditPort: UserMemoryAuditPort = {
  record(event) {
    console.info("[user-memory] audit", event);
  },
};

function defaultSettings(scope: MemoryScope): MemorySettings {
  return {
    tenantId: scope.tenantId as MemorySettings["tenantId"],
    userId: scope.userId as MemorySettings["userId"],
    enabled: true,
    settingsVersion: 0,
    disabledAt: null,
    updatedAt: new Date().toISOString(),
  };
}

function fingerprint(scope: MemoryScope, summary: string): string {
  return createHash("sha256")
    .update(`${scope.tenantId}:${scope.userId}:${summary.toLowerCase()}`)
    .digest("hex");
}

function toMemoryDTO(row: unknown): UserMemory {
  const record = row as Record<string, unknown>;
  return {
    id: String(record.id),
    tenantId: String(record.tenantId) as UserMemory["tenantId"],
    userId: String(record.userId) as UserMemory["userId"],
    summary: String(record.summary),
    source: String(record.source),
    status: record.status as UserMemory["status"],
    eligibility: record.eligibility as UserMemory["eligibility"],
    consentStatus: record.consentStatus as UserMemory["consentStatus"],
    consentedAt: toIso(record.consentedAt)!,
    revokedAt: toIso(record.revokedAt),
    disabledAt: toIso(record.disabledAt),
    deletedAt: toIso(record.deletedAt),
    idempotencyKey: String(record.idempotencyKey),
    fingerprint: String(record.fingerprint),
    schemaVersion: String(record.schemaVersion),
    embeddingProvider: String(record.embeddingProvider),
    embeddingModel: String(record.embeddingModel),
    embeddingVersion: String(record.embeddingVersion),
    embeddingDimension: Number(record.embeddingDimension),
    createdAt: toIso(record.createdAt)!,
    updatedAt: toIso(record.updatedAt)!,
  };
}

function toSettingsDTO(row: unknown): MemorySettings {
  const record = row as Record<string, unknown>;
  return {
    tenantId: String(record.tenantId) as MemorySettings["tenantId"],
    userId: String(record.userId) as MemorySettings["userId"],
    enabled: Boolean(record.enabled),
    settingsVersion: Number(record.settingsVersion),
    disabledAt: toIso(record.disabledAt),
    updatedAt: toIso(record.updatedAt)!,
  };
}

function toIso(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}
