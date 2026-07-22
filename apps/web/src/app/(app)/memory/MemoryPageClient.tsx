"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ListUserMemoriesResponse, MemorySettings, UserMemory } from "@kinora/contracts";
import { useTranslations } from "next-intl";
import {
  createUserMemoryAction,
  deleteUserMemoryAction,
  getUserMemoriesAction,
  updateMemorySettingsAction,
} from "./actions";

export interface MemoryPageClientProps {
  initialData: ListUserMemoriesResponse | null;
  initialError?: string | null;
}

function sortMemories(memories: UserMemory[]): UserMemory[] {
  return [...memories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function mergeMemory(memories: UserMemory[], next: UserMemory): UserMemory[] {
  return sortMemories([next, ...memories.filter((memory) => memory.id !== next.id)]);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

export function MemoryPageClient({ initialData, initialError = null }: MemoryPageClientProps) {
  const t = useTranslations();
  const [data, setData] = useState<ListUserMemoriesResponse | null>(
    initialData ? { ...initialData, memories: sortMemories(initialData.memories) } : null,
  );
  const [error, setError] = useState<string | null>(initialError);
  const [factText, setFactText] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"status" | "alert">("status");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const settings: MemorySettings | null = data?.settings ?? null;
  const memories = data?.memories ?? [];
  const trimmedFactText = factText.trim();
  const isOfflineState = !data && error === "api_unreachable" && !online;
  const isErrorState = !data && !!error && !isOfflineState;
  const isEmptyState = !!data && memories.length === 0;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if ((isOfflineState || isErrorState) && retryButtonRef.current) {
      retryButtonRef.current.focus();
    }
  }, [isErrorState, isOfflineState]);

  useEffect(() => {
    if ((pendingDeleteId || confirmDisable) && confirmButtonRef.current) {
      confirmButtonRef.current.focus();
    }
  }, [pendingDeleteId, confirmDisable]);

  const pendingDeleteMemory = useMemo(
    () => memories.find((memory) => memory.id === pendingDeleteId) ?? null,
    [memories, pendingDeleteId],
  );

  async function handleRetry() {
    setLoading(true);
    setError(null);
    setStatusMessage(null);
    setStatusTone("status");

    const result = await getUserMemoriesAction();
    if (result.kind === "ok") {
      setData({ ...result.data, memories: sortMemories(result.data.memories) });
    } else {
      setError(result.message);
    }

    setLoading(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!settings?.enabled || trimmedFactText.length === 0 || submitting) {
      return;
    }

    setSubmitting(true);
    setStatusMessage(null);
    setError(null);
    setStatusTone("status");
    const result = await createUserMemoryAction({ factText: trimmedFactText });

    if (result.kind === "ok") {
      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          memories: mergeMemory(current.memories, result.data.memory),
        };
      });
      setFactText("");
      setStatusMessage(t("memory.form.saved"));
      setStatusTone("status");
    } else if (result.kind === "validation_error") {
      setStatusMessage(
        result.message === "memory_ineligible"
          ? t("memory.form.ineligible")
          : t("memory.form.error"),
      );
      setStatusTone("alert");
    } else {
      setStatusMessage(t("memory.form.error"));
      setStatusTone("alert");
      setError(result.message);
    }

    setSubmitting(false);
  }

  async function handleConfirmDelete() {
    if (!pendingDeleteId) return;

    const targetId = pendingDeleteId;
    setPendingDeleteId(null);
    const result = await deleteUserMemoryAction(targetId);
    if (result.kind === "ok") {
      setData((current) =>
        current
          ? {
              ...current,
              memories: current.memories.filter((memory) => memory.id !== targetId),
            }
          : current,
      );
      setStatusMessage(t("memory.status.deleted"));
      setStatusTone("status");
      return;
    }

    setStatusMessage(t("memory.form.error"));
    setStatusTone("alert");
    setError(result.message);
  }

  async function handleSetEnabled(enabled: boolean) {
    const result = await updateMemorySettingsAction(enabled);
    if (result.kind === "ok") {
      setData((current) =>
        current
          ? {
              ...current,
              settings: result.data,
            }
          : current,
      );
      setStatusMessage(t(enabled ? "memory.status.enabled" : "memory.status.disabled"));
      setStatusTone("status");
      return;
    }

    setStatusMessage(t("memory.form.error"));
    setStatusTone("alert");
    setError(result.message);
  }

  if (loading && !data) {
    return <MemoryLoadingState />;
  }

  if (isOfflineState) {
    return (
      <MemoryStatusCard
        title={t("memory.states.offlineTitle")}
        description={t("memory.states.offlineDescription")}
        retryRef={retryButtonRef}
        onRetry={handleRetry}
      />
    );
  }

  if (isErrorState) {
    return (
      <MemoryStatusCard
        title={t("memory.states.errorTitle")}
        description={t("memory.states.errorDescription")}
        retryRef={retryButtonRef}
        onRetry={handleRetry}
      />
    );
  }

  return (
    <section className="kin-card kin-card--center" style={{ maxWidth: 760 }}>
      <h2 className="kin-title">{t("memory.title")}</h2>
      <p className="kin-text kin-muted" style={{ marginBottom: "1rem" }}>
        {t("memory.description")}
      </p>

      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
        <p className="kin-text kin-muted">{t("memory.form.help")}</p>
        {settings?.enabled ? (
          <button type="button" className="kin-btn kin-btn--ghost" onClick={() => setConfirmDisable(true)}>
            {t("memory.controls.disable")}
          </button>
        ) : (
          <button type="button" className="kin-btn kin-btn--primary" onClick={() => void handleSetEnabled(true)}>
            {t("memory.controls.enable")}
          </button>
        )}
      </div>

      {confirmDisable ? (
        <section role="alertdialog" aria-label={t("memory.confirm.disableTitle")} className="kin-card" style={{ marginBottom: "1rem" }}>
          <p className="kin-text">{t("memory.confirm.disableBody")}</p>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
            <button
              ref={confirmButtonRef}
              type="button"
              className="kin-btn kin-btn--ghost"
              onClick={() => {
                setConfirmDisable(false);
                void handleSetEnabled(false);
              }}
            >
              {t("memory.confirm.disableConfirm")}
            </button>
            <button type="button" className="kin-btn kin-btn--primary" onClick={() => setConfirmDisable(false)}>
              {t("memory.confirm.cancel")}
            </button>
          </div>
        </section>
      ) : null}

      <form onSubmit={handleCreate} className="kin-card" style={{ width: "100%", marginBottom: "1rem" }}>
        <label htmlFor="memory-fact" style={{ display: "block", marginBottom: "0.5rem" }}>
          {t("memory.form.label")}
        </label>
        <textarea
          id="memory-fact"
          className="kin-input"
          style={{ width: "100%", minHeight: 96, resize: "vertical" }}
          value={factText}
          disabled={!settings?.enabled || submitting}
          placeholder={t("memory.form.placeholder")}
          onChange={(event) => {
            setFactText(event.target.value);
            setStatusMessage(null);
          }}
        />
        {!settings?.enabled ? (
          <p className="kin-text kin-muted" style={{ marginTop: "0.5rem" }}>
            {t("memory.form.disabledHint")}
          </p>
        ) : null}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
          <button
            type="submit"
            className="kin-btn kin-btn--primary"
            disabled={!settings?.enabled || trimmedFactText.length === 0 || submitting}
          >
            {submitting ? t("memory.form.saving") : t("memory.form.submit")}
          </button>
          {statusMessage ? (
            <p role={statusTone} className="kin-text">
              {statusMessage}
            </p>
          ) : null}
        </div>
      </form>

      {isEmptyState ? (
        <div className="kin-card" style={{ width: "100%" }}>
          <h3 className="kin-title" style={{ fontSize: "1.125rem" }}>{t("memory.states.emptyTitle")}</h3>
          <p className="kin-text kin-muted">{t("memory.states.emptyDescription")}</p>
        </div>
      ) : (
        <ul aria-label={t("memory.list.label")} style={{ listStyle: "none", padding: 0, margin: 0, width: "100%", display: "grid", gap: "0.75rem" }}>
          {memories.map((memory) => (
            <li key={memory.id} className="kin-card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                <div>
                  <h3 className="kin-title" style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
                    {memory.summary}
                  </h3>
                  <p className="kin-text kin-muted">
                    {t("memory.item.metadata", {
                      source: t("memory.item.userConfirmationSource"),
                      createdAt: formatDate(memory.createdAt),
                    })}
                  </p>
                </div>
                <button
                  type="button"
                  className="kin-btn kin-btn--ghost"
                  aria-label={t("memory.controls.deleteAria", { summary: memory.summary })}
                  onClick={() => setPendingDeleteId(memory.id)}
                >
                  {t("memory.controls.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pendingDeleteMemory ? (
        <section role="alertdialog" aria-label={t("memory.confirm.deleteTitle")} className="kin-card" style={{ marginTop: "1rem", width: "100%" }}>
          <p className="kin-text">{t("memory.confirm.deleteBody", { summary: pendingDeleteMemory.summary })}</p>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
            <button ref={confirmButtonRef} type="button" className="kin-btn kin-btn--ghost" onClick={() => void handleConfirmDelete()}>
              {t("memory.confirm.deleteConfirm")}
            </button>
            <button type="button" className="kin-btn kin-btn--primary" onClick={() => setPendingDeleteId(null)}>
              {t("memory.confirm.cancel")}
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function MemoryStatusCard({
  title,
  description,
  onRetry,
  retryRef,
}: {
  title: string;
  description: string;
  onRetry: () => void;
  retryRef: RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations();

  return (
    <section className="kin-card kin-card--center" style={{ maxWidth: 640 }}>
      <h2 className="kin-title">{title}</h2>
      <p className="kin-text kin-muted">{description}</p>
      <button ref={retryRef} type="button" className="kin-btn kin-btn--primary" onClick={onRetry}>
        {t("memory.states.retry")}
      </button>
    </section>
  );
}

function MemoryLoadingState() {
  const t = useTranslations();

  return (
    <section className="kin-card kin-card--center" style={{ maxWidth: 640 }}>
      <div role="status" aria-live="polite" className="kin-text">
        <div role="progressbar" aria-busy="true" aria-label={t("memory.loading.progressAria")} />
        <h2 className="kin-title" style={{ marginTop: "1rem" }}>{t("memory.loading.title")}</h2>
        <p className="kin-text kin-muted">{t("memory.loading.description")}</p>
      </div>
    </section>
  );
}
