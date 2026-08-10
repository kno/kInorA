import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalogs, flattenMessages } from "../index.js";

/**
 * Reconciles the catalog against the code that renders it, in both directions.
 *
 * This is the guard that actually survives a bad merge (kno/kInorA#428). The
 * frozen whole-catalog total it replaces could not: a merge that dropped keys
 * AND the number describing them was internally consistent and stayed green.
 * A key rendered by code that no longer exists in the catalog is not, however
 * the merge was resolved — the surviving call site names the missing key. That
 * is exactly the shape of the incident that opened the issue: #418 shipped two
 * `mobileTracker.*` keys together with the mobile code that renders them, and
 * the merge kept the code while discarding the keys.
 *
 * Two directions, two precisions:
 *
 * - **usage -> catalog** (`missingKeys`): PRECISE. Only real translator call
 *   sites count — `useTranslations`/`getTranslations` bindings resolved
 *   positionally (the same `t` name is rebound per component with a different
 *   namespace), plus react-intl `id:` message descriptors. Anything it reports
 *   is a render that will throw or fall back at runtime.
 * - **catalog -> usage** (`unreferencedKeys`): DELIBERATELY LOOSE. Any string
 *   literal that resolves to a key counts as a reference, and a template
 *   prefix such as `t(`issues.${issue}`)` covers the whole subtree. A guard
 *   that cries wolf gets deleted, so it reports only keys nothing plausibly
 *   reaches.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SOURCE_ROOTS = ["apps", "packages"];
const SKIPPED_DIRS = /^(node_modules|dist|build|coverage|\.next|\.expo|android|ios)$/;
// This package is excluded from the scan: its own tests assert on catalog keys
// by definition, so scanning them would mark every key "referenced" by the very
// suite that is supposed to notice dead ones.
const SELF = join("packages", "i18n");

/**
 * Keys that are shipped but rendered nowhere. It is EMPTY, and that is the
 * point: the guard now holds the catalog to "every key has a call site" with
 * no exemptions at all.
 *
 * It landed with 37 entries — the dead copy this guard found on its first run,
 * carried for one release so 37 keys of catalog churn would not collide with
 * the branches then in flight — and kno/kInorA#436 deleted all 37 from both
 * catalogs. Every one was checked against its own history first, because a key
 * dead because its feature was REMOVED should go, while a key dead because its
 * feature is half-built is a signal about the feature. All 37 were the former:
 *
 * - `stats.{distributionComingSoon,prComingSoon}` read like placeholders for
 *   unbuilt surfaces, and were not. Both surfaces SHIPPED in b3a022e (09c
 *   slice 3b), which replaced the placeholder paragraphs with the real
 *   distribution chart and PR table and left the copy behind.
 * - `sidebar.*` was dead as a whole namespace because the component was
 *   replaced, not because strings drifted: `SidebarNav` renders `appNav.*`.
 * - `plan.{sets,reps,rest}.label` and `tracker.start.cta` died with the legacy
 *   plan list in #340; the live tracker renders `tracker.{rest,load}.label`.
 * - `hiw.step*.num` never had a call site — `LandingHowItWorks` hardcodes the
 *   step numbers "01"/"02"/"03", which are not translatable copy.
 *
 * Nothing may be ADDED here to make a new key pass, and there is no longer any
 * precedent for doing so. A key nobody renders is copy that drifts out of sync
 * with the product in silence; author it in the commit that renders it.
 */
const KNOWN_UNREFERENCED_KEYS: readonly string[] = [];

/** `const t = useTranslations("ns")`, `const t = await getTranslations()`, … */
const TRANSLATOR_BINDING =
  /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:\{[^}]*namespace:\s*)?(?:["']([\w.]+)["'])?/g;
/** react-intl descriptors: `formatMessage({ id: "…" })`, `defineMessages({…})`. */
const MESSAGE_DESCRIPTOR_ID = /\bid:\s*["']([\w]+(?:\.[\w]+)+)["']/g;
const STRING_LITERAL = /["'`]([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)["'`]/g;
const TEMPLATE_PREFIX = /[`"']([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\.?)\$\{/g;

function translatorCalls(name: string): RegExp {
  return new RegExp(
    `\\b${name.replace(/\$/g, "\\$")}(?:\\.(?:rich|raw|markup|has))?\\(\\s*["']([\\w.]+)["']`,
    "g",
  );
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.test(entry.name) || path.endsWith(SELF)) continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) found.push(path);
  }

  return found;
}

type Reconciliation = {
  /** Keys the code renders that the catalog does not ship, with a call site. */
  missing: string[];
  /** Keys the catalog ships that no source file appears to render. */
  unreferenced: string[];
};

function reconcile(): Reconciliation {
  const keys = new Set(Object.keys(flattenMessages(catalogs.en)));
  const namespaces = new Set([...keys].map((key) => key.split(".")[0]!));

  const referenced = new Set<string>();
  const prefixes = new Set<string>();
  const missing = new Map<string, string>();

  const files = SOURCE_ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root)));
  // A scanner that silently stopped finding files would report the whole
  // catalog as dead and nothing as missing, so prove it found the sources.
  expect(files.length).toBeGreaterThan(100);
  let callSites = 0;

  for (const file of files) {
    const source = readFileSync(file, "utf8");

    const bindings = [...source.matchAll(TRANSLATOR_BINDING)].map((match) => ({
      name: match[1]!,
      // No argument means the root scope: `t("plan.title")` is a full key.
      scope: match[2] ? `${match[2]}.` : "",
      at: match.index,
    }));

    // usage -> catalog, via resolved translator call sites.
    for (const name of new Set(bindings.map((binding) => binding.name))) {
      for (const call of source.matchAll(translatorCalls(name))) {
        // The same identifier is rebound per component with a different
        // namespace, so the nearest PRECEDING binding is the live one.
        const binding = bindings.filter((b) => b.name === name && b.at < call.index).pop();
        if (!binding) continue;

        callSites += 1;
        const key = binding.scope + call[1]!;
        if (keys.has(key)) continue;
        // An unscoped translator can be handed a non-message string; only a
        // key under a REAL namespace is evidence of a dropped catalog key.
        if (!binding.scope && !namespaces.has(call[1]!.split(".")[0]!)) continue;
        if (!missing.has(key)) missing.set(key, relative(REPO_ROOT, file));
      }
    }
    for (const match of source.matchAll(MESSAGE_DESCRIPTOR_ID)) {
      const id = match[1]!;
      callSites += 1;
      if (keys.has(id) || !namespaces.has(id.split(".")[0]!)) continue;
      if (!missing.has(id)) missing.set(id, relative(REPO_ROOT, file));
    }

    // catalog -> usage, via any literal that resolves under any scope in scope.
    const scopes = new Set<string>(["", ...bindings.map((binding) => binding.scope)]);
    for (const match of source.matchAll(STRING_LITERAL)) {
      const literal = match[1]!;
      for (const scope of scopes) {
        if (keys.has(scope + literal)) referenced.add(scope + literal);
      }
    }
    for (const match of source.matchAll(TEMPLATE_PREFIX)) {
      const prefix = match[1]!;
      // A bare leading `${…}` would match everything; require a real prefix so
      // one template cannot silence the whole catalog.
      if (prefix.length > 1) for (const scope of scopes) prefixes.add(scope + prefix);
    }
  }

  // Same rationale as the file-count floor: a binding regex that stopped
  // matching would resolve nothing and report nothing.
  expect(callSites).toBeGreaterThan(500);

  return {
    missing: [...missing].map(([key, file]) => `${key} (${file})`).sort(),
    unreferenced: [...keys]
      .filter((key) => !referenced.has(key))
      .filter((key) => ![...prefixes].some((prefix) => key.startsWith(prefix)))
      .sort(),
  };
}

let cached: Reconciliation | undefined;

/** The scan reads ~950 files; every test in this file wants the same answer. */
function reconciliation(): Reconciliation {
  cached ??= reconcile();
  return cached;
}

describe("catalog key usage", () => {
  it("ships every key the web and mobile code renders", () => {
    // THE merge guard: a resolution that discarded another branch's keys
    // leaves their call sites behind, and this names them. It does not care
    // whether the drop came from the catalogs, a manifest, or both.
    expect(reconciliation().missing).toEqual([]);
  });

  it("ships no key that web or mobile never renders", () => {
    const known = new Set<string>(KNOWN_UNREFERENCED_KEYS);

    expect(reconciliation().unreferenced.filter((key) => !known.has(key))).toEqual([]);
  });

  it("keeps the known-unreferenced list free of entries that no longer apply", () => {
    const unreferenced = new Set(reconciliation().unreferenced);

    // An entry that is now rendered — or gone from the catalog — must be
    // deleted, otherwise the list slowly turns into a blanket exemption.
    expect(KNOWN_UNREFERENCED_KEYS.filter((key) => !unreferenced.has(key))).toEqual([]);
  });
});
