"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BrandingPalette } from "@kinora/contracts";
import {
  PALETTE_TOKENS,
  EMPTY_PALETTE,
  BRANDING_PRESETS,
  SUBDOMAIN_HOST,
  type PaletteGroup,
  type PaletteTokenKey,
  isValidSlug,
  contrastRatio,
  hasSufficientContrast,
  resolveSwatchHex,
  scopedGymStyle,
} from "./branding-constants";
import { saveBrandingAction, uploadLogoAction } from "./actions";

export interface BrandingInitial {
  subdomainSlug: string;
  logoUrl: string | null;
  palette: BrandingPalette;
}

export interface BrandingStudioProps {
  initial: BrandingInitial;
  /**
   * True when the server could not read the current branding
   * (kno/kInorA#378). `initial` still seeds the studio with blank defaults
   * so it renders, but Save is disabled — and `handleSave` guards against it
   * too, defense-in-depth against a bypassed disabled state — so an owner
   * can never overwrite a real subdomain/logo/palette while believing the
   * blank form reflects reality.
   */
  loadFailed?: boolean;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const PREVIEW_SELECTOR = ".brand-preview";

/** Drop any token whose value is not a well-formed `#rrggbb` (keeps the
 * preview + save payload clean while a hex field is mid-edit). */
function sanitizePalette(palette: BrandingPalette): BrandingPalette {
  const clean = { ...EMPTY_PALETTE };
  for (const { key } of PALETTE_TOKENS) {
    const value = palette[key];
    clean[key] = value && HEX_RE.test(value) ? value : null;
  }
  return clean;
}

const GROUP_ORDER: readonly PaletteGroup[] = ["brand", "surfaces", "text"] as const;

/**
 * BrandingStudio — the client-side white-label studio (16a-v3-gym-white-label).
 *
 * A two-column live-preview studio: the left column edits the subdomain, logo,
 * and the six palette tokens; the right column is a mini mock of the app chrome
 * that re-themes IN REAL TIME by injecting the current palette as scoped
 * `--gym-*` custom properties (via the SAME `buildGymStyleBlock` the app uses)
 * onto the preview container ONLY — the real chrome is never re-themed while
 * editing. Imports ONLY the server actions + the client-safe constants (never
 * the server-only client module) so `ui-api-guard` passes.
 */
export function BrandingStudio({ initial, loadFailed = false }: BrandingStudioProps) {
  const t = useTranslations("brandingStudio");

  const [slug, setSlug] = useState(initial.subdomainSlug);
  const [palette, setPalette] = useState<BrandingPalette>(initial.palette);
  const [logoUrl, setLogoUrl] = useState<string | null>(initial.logoUrl);
  const [uploading, setUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const cleanPalette = useMemo(() => sanitizePalette(palette), [palette]);
  const previewStyle = useMemo(
    () => scopedGymStyle(cleanPalette, PREVIEW_SELECTOR),
    [cleanPalette],
  );

  const slugValid = slug.length === 0 || isValidSlug(slug);

  function setToken(key: PaletteTokenKey, value: string | null) {
    setPalette((prev) => ({ ...prev, [key]: value }));
    setSave({ kind: "idle" });
  }

  function applyPreset(preset: Record<PaletteTokenKey, string>) {
    setPalette({ ...preset });
    setSave({ kind: "idle" });
  }

  function resetPalette() {
    setPalette({ ...EMPTY_PALETTE });
    setSave({ kind: "idle" });
  }

  async function handleFile(file: File | undefined | null) {
    if (!file) return;
    setLogoError(null);
    setUploading(true);
    const form = new FormData();
    form.append("file", file, file.name);
    const result = await uploadLogoAction(form);
    setUploading(false);
    if (result.kind === "ok") {
      setLogoUrl(result.logoUrl);
    } else if (result.kind === "unsupported") {
      setLogoError(t("logo.unsupported"));
    } else if (result.kind === "too_large") {
      setLogoError(t("logo.tooLarge"));
    } else {
      setLogoError(t("logo.uploadError"));
    }
  }

  async function handleSave() {
    if (loadFailed) return; // guard against a bypassed disabled state
    if (!isValidSlug(slug)) {
      setSave({ kind: "error", message: t("subdomain.invalid") });
      return;
    }
    setSave({ kind: "saving" });
    const result = await saveBrandingAction({ subdomainSlug: slug, palette: cleanPalette });
    if (result.kind === "ok") {
      setSave({ kind: "saved" });
      setLogoUrl(result.branding.logoUrl);
    } else if (result.kind === "conflict") {
      setSave({ kind: "error", message: t("errors.conflict") });
    } else if (result.kind === "invalid") {
      setSave({ kind: "error", message: t("errors.invalid") });
    } else {
      setSave({ kind: "error", message: t("errors.generic") });
    }
  }

  // Contrast quality hints.
  const accentPair = contrastRatio(
    resolveSwatchHex("accent", cleanPalette),
    resolveSwatchHex("accentFg", cleanPalette),
  );
  const textPair = contrastRatio(
    resolveSwatchHex("fg", cleanPalette),
    resolveSwatchHex("surface", cleanPalette),
  );
  const accentOk = hasSufficientContrast(
    resolveSwatchHex("accent", cleanPalette),
    resolveSwatchHex("accentFg", cleanPalette),
  );
  const textOk = hasSufficientContrast(
    resolveSwatchHex("fg", cleanPalette),
    resolveSwatchHex("surface", cleanPalette),
  );

  return (
    <div className="branding-studio">
      <style data-testid="branding-preview-style">{previewStyle}</style>

      {/* ---------------- Controls ---------------- */}
      <section className="branding-controls" aria-label={t("palette.label")}>
        {/* Subdomain */}
        <div className="branding-panel">
          <label className="kin-label" htmlFor="branding-slug">
            {t("subdomain.label")}
          </label>
          <input
            id="branding-slug"
            data-testid="slug-input"
            type="text"
            className="kin-input"
            value={slug}
            spellCheck={false}
            autoCapitalize="none"
            placeholder={t("subdomain.placeholder")}
            aria-invalid={!slugValid}
            onChange={(e) => {
              setSlug(e.target.value.trim().toLowerCase());
              setSave({ kind: "idle" });
            }}
          />
          <div className="branding-url-chip" aria-label={t("subdomain.urlPreviewLabel")}>
            <span className="branding-url-slug">{slug || t("subdomain.placeholder")}</span>
            <span className="branding-url-host">.{SUBDOMAIN_HOST}</span>
          </div>
          {!slugValid && (
            <p className="branding-inline-error" role="alert">
              {t("subdomain.invalid")}
            </p>
          )}
          <p className="branding-hint">{t("subdomain.hint")}</p>
        </div>

        {/* Logo */}
        <div className="branding-panel">
          <span className="kin-label">{t("logo.label")}</span>
          <div
            className={`branding-dropzone${dragging ? " is-dragging" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void handleFile(e.dataTransfer.files?.[0]);
            }}
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                data-testid="logo-preview-img"
                className="branding-dropzone-logo"
                src={logoUrl}
                alt={t("logo.alt")}
              />
            ) : (
              <span className="branding-dropzone-empty">{t("logo.empty")}</span>
            )}
            <span className="branding-dropzone-cta">
              {uploading ? t("logo.uploading") : t("logo.dropHint")}
            </span>
          </div>
          <input
            ref={fileInputRef}
            data-testid="logo-file-input"
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            hidden
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          <p className="branding-hint">{t("logo.formats")}</p>
          {logoError && (
            <p className="branding-inline-error" role="alert">
              {logoError}
            </p>
          )}
        </div>

        {/* Palette */}
        <div className="branding-panel">
          <span className="kin-label">{t("palette.label")}</span>
          <p className="branding-hint">{t("palette.hint")}</p>

          {GROUP_ORDER.map((group) => (
            <div key={group} className="branding-token-group">
              <p className="branding-group-title">{t(`groups.${group}`)}</p>
              {PALETTE_TOKENS.filter((token) => token.group === group).map((token) => {
                const swatch = resolveSwatchHex(token.key, palette);
                const isDefault = palette[token.key] === null;
                return (
                  <div key={token.key} className="branding-token-row">
                    <label
                      className="branding-swatch"
                      style={{ background: swatch }}
                      aria-label={t(`tokens.${token.labelKey}`)}
                    >
                      <input
                        data-testid={`swatch-${token.key}`}
                        type="color"
                        value={swatch}
                        onChange={(e) => setToken(token.key, e.target.value)}
                      />
                    </label>
                    <div className="branding-token-body">
                      <span className="branding-token-name">
                        {t(`tokens.${token.labelKey}`)}
                        {isDefault && <span className="branding-token-default" />}
                      </span>
                      <input
                        data-testid={`hex-${token.key}`}
                        type="text"
                        className="kin-input branding-hex-input"
                        value={swatch}
                        spellCheck={false}
                        aria-label={t(`tokens.${token.labelKey}`)}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          setToken(token.key, raw === "" ? null : raw);
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {/* Presets + reset */}
          <div className="branding-presets">
            <span className="branding-presets-label">{t("presets.label")}</span>
            <div className="branding-presets-row">
              {BRANDING_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="branding-preset-chip"
                  onClick={() => applyPreset(preset.palette)}
                  style={{
                    background: preset.palette.surface,
                    borderColor: preset.palette.accent,
                  }}
                >
                  <span
                    className="branding-preset-dot"
                    style={{ background: preset.palette.accent }}
                  />
                  {t(`presets.${preset.id}`)}
                </button>
              ))}
              <button
                type="button"
                data-testid="reset-palette"
                className="branding-preset-chip branding-preset-reset"
                onClick={resetPalette}
              >
                {t("presets.reset")}
              </button>
            </div>
          </div>

          {/* Contrast hints */}
          <div className="branding-contrast" aria-label={t("contrast.label")}>
            <ContrastRow
              label={t("contrast.accentPair")}
              ratio={accentPair}
              ok={accentOk}
              okLabel={t("contrast.pass")}
              warnLabel={t("contrast.warn")}
            />
            <ContrastRow
              label={t("contrast.textPair")}
              ratio={textPair}
              ok={textOk}
              okLabel={t("contrast.pass")}
              warnLabel={t("contrast.warn")}
            />
          </div>
        </div>

        {/* Save */}
        <div className="branding-save-bar">
          <button
            type="button"
            data-testid="save-branding"
            className="kin-btn kin-btn--accent"
            disabled={save.kind === "saving" || loadFailed}
            onClick={() => void handleSave()}
          >
            {save.kind === "saving" ? t("save.saving") : t("save.button")}
          </button>
          {save.kind === "saved" && (
            <span className="branding-saved" data-testid="branding-saved" role="status">
              {t("save.saved")}
            </span>
          )}
          {save.kind === "error" && (
            <span className="branding-inline-error" data-testid="branding-error" role="alert">
              {save.message}
            </span>
          )}
        </div>
      </section>

      {/* ---------------- Live preview ---------------- */}
      <section className="branding-preview-wrap" aria-label={t("preview.label")}>
        <p className="branding-preview-caption">{t("preview.label")}</p>
        <div className="brand-preview">
          <aside className="bp-sidebar">
            <div className="bp-brand">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="bp-logo" src={logoUrl} alt={t("logo.alt")} />
              ) : (
                <span className="bp-logo-fallback">{t("preview.logoFallback")}</span>
              )}
            </div>
            <nav className="bp-nav">
              <span className="bp-nav-item is-active">{t("preview.navDashboard")}</span>
              <span className="bp-nav-item">{t("preview.navPlan")}</span>
              <span className="bp-nav-item">{t("preview.navProgress")}</span>
            </nav>
          </aside>
          <div className="bp-main">
            <header className="bp-header">
              <span className="bp-header-title">{t("preview.headerTitle")}</span>
              <span className="bp-badge">{t("preview.badge")}</span>
            </header>
            <div className="bp-card">
              <h3 className="bp-card-title">{t("preview.cardTitle")}</h3>
              <p className="bp-card-body">{t("preview.cardBody")}</p>
              <p className="bp-muted">{t("preview.mutedNote")}</p>
              <div className="bp-actions">
                <button type="button" className="bp-btn-primary">
                  {t("preview.primaryCta")}
                </button>
                <button type="button" className="bp-btn-secondary">
                  {t("preview.secondaryCta")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ContrastRow({
  label,
  ratio,
  ok,
  okLabel,
  warnLabel,
}: {
  label: string;
  ratio: number;
  ok: boolean;
  okLabel: string;
  warnLabel: string;
}) {
  return (
    <div className={`branding-contrast-row${ok ? " is-ok" : " is-warn"}`}>
      <span className="branding-contrast-icon" aria-hidden="true">
        {ok ? "✓" : "!"}
      </span>
      <span className="branding-contrast-label">{label}</span>
      <span className="branding-contrast-ratio">{ratio.toFixed(2)}:1</span>
      <span className="branding-contrast-verdict">{ok ? okLabel : warnLabel}</span>
    </div>
  );
}
