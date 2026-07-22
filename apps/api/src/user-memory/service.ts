import { createHash } from "node:crypto";
import type {
  CreateUserMemoryRequest,
  ListUserMemoriesResponse,
  MemorySettings,
  UserMemory,
} from "@kinora/contracts";
import type { EmbeddingFailureReason } from "../ai/embedding-port.js";
import type {
  PersistVectorMemoryInput,
  PersistVectorMemoryResult,
} from "../ai/memory-retriever.js";

type MemoryScope = { tenantId: string; userId: string };

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
  | { kind: "failed"; reason: EmbeddingFailureReason | "disabled" };

const SCHEMA_VERSION = "1";
const SECRET_PATTERNS = [/\bpassword\b/i, /\bapi[_ -]?key\b/i, /\btoken\b/i, /\bsecret\b/i];
const RAW_TRANSCRIPT_PATTERNS = [/^user:/im, /^assistant:/im, /^speaker\s*\d+:/im, /transcript/i];
const FULL_PLAN_PATTERNS = [/weeklysessions/i, /day\s*1/i, /restSeconds/i, /sets?\s*[x×-]\s*reps?/i];
const SENSITIVE_HEALTH_PATTERNS = [
  /\bdiagnos/i,
  /\binjury\b/i,
  /\bpain\b/i,
  /\brehab\b/i,
  /\bhernia/i,
  /\bmedication\b/i,
  /\bdiabetes\b/i,
  /\bblood pressure\b/i,
];

export class UserMemoryLifecycleService {
  constructor(
    private readonly repo: UserMemoryRepositoryPort,
    private readonly writer: UserMemoryWriterPort,
    private readonly audit: UserMemoryAuditPort,
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
  if (input.length < 3) {
    return "other";
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(input))) {
    return "secret";
  }
  if (RAW_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(input))) {
    return "raw_transcript";
  }
  if (FULL_PLAN_PATTERNS.some((pattern) => pattern.test(input))) {
    return "full_plan";
  }
  if (SENSITIVE_HEALTH_PATTERNS.some((pattern) => pattern.test(input))) {
    return "sensitive_health";
  }
  return "eligible";
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
