#!/usr/bin/env node

/**
 * Exercise-catalog importer — regenerates `@kinora/exercise-catalog` data and
 * the media it references from the upstream `hasaneyldrm/exercises-dataset`.
 *
 * It is idempotent and safe to re-run: the catalog JSON is rewritten
 * deterministically (stable key order, sorted by upstream id) and media files
 * that already exist on disk with a non-empty body are skipped.
 *
 *   node scripts/import-exercise-catalog.ts             # catalog + JPG thumbnails
 *   node scripts/import-exercise-catalog.ts --data-only # catalog only, no media
 *   node scripts/import-exercise-catalog.ts --with-gifs # also mirror the GIFs locally
 *
 * MEDIA STRATEGY (hybrid) — the two asset classes are served differently:
 *   - JPG thumbnails (~8.5 MB) are SELF-HOSTED under `apps/web/public/exercises/
 *     images/` and referenced by an app-absolute `imagePath`. Downloaded by
 *     default.
 *   - Animated GIFs (~123 MB) are served from the jsDelivr CDN off the upstream
 *     repository, so they never enter the Docker build context or image.
 *     `gifPath` is therefore an absolute https URL and NO gif is downloaded by
 *     default.
 * `--with-gifs` still mirrors every GIF into `apps/web/public/exercises/videos/`.
 * That path is an intentional escape hatch (cold backup / self-host fallback if
 * jsDelivr ever becomes unavailable), NOT dead code — do not delete it.
 *
 * LICENSING — the import crosses two different licenses:
 *   - the DATA is MIT (c) 2026 Hasan Emir Yildirim;
 *   - the MEDIA is (c) Gym visual (https://gymvisual.com/) and is NOT MIT.
 * Every record's `attribution` field is copied verbatim into the catalog and
 * `apps/web/public/exercises/ATTRIBUTION.md` reproduces the upstream NOTICE.
 * Neither may be dropped.
 *
 * Run with plain `node` — Node >= 24 strips the type annotations natively, so
 * no extra toolchain is required (this script is not part of any build).
 */

import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const DATASET_REPO = "https://github.com/hasaneyldrm/exercises-dataset";
const DATASET_RAW_BASE =
  "https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main";
const DATASET_SOURCE_URL = `${DATASET_RAW_BASE}/data/exercises.json`;

/**
 * Upstream commit the CDN-served GIFs are pinned to (`main` as of 2026-07-16).
 *
 * WHY A SHA AND NOT A BRANCH: `@main` is a MOVING reference. A force-push, a
 * media re-encode, a rename or a file removal upstream would silently change or
 * 404 every animation in production with no deploy on our side and no signal in
 * this repository — and jsDelivr caches branch refs aggressively, so the
 * breakage would be both invisible and hard to reproduce. A commit SHA is
 * immutable and permanently cacheable: the URLs we ship can only ever resolve to
 * the exact bytes we validated.
 *
 * Bumping this constant is a deliberate, reviewable act: change the SHA, re-run
 * this script, and re-verify a sample of URLs.
 */
const DATASET_PINNED_SHA = "7455efae41b330c265e7cd4b78dfa848e7ce5ebd";

/** SHA-pinned jsDelivr base for the GIFs referenced by `gifPath`. */
const GIF_CDN_BASE = `https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@${DATASET_PINNED_SHA}/videos`;

const CATALOG_DIR = join(ROOT, "packages", "exercise-catalog", "data");
const CATALOG_FILE = join(CATALOG_DIR, "exercises.catalog.json");

const MEDIA_ROOT = join(ROOT, "apps", "web", "public", "exercises");
const IMAGES_DIR = join(MEDIA_ROOT, "images");
const VIDEOS_DIR = join(MEDIA_ROOT, "videos");
const ATTRIBUTION_FILE = join(MEDIA_ROOT, "ATTRIBUTION.md");

/** App-absolute prefix for the self-hosted thumbnails served by `apps/web/public`. */
const PUBLIC_IMAGE_PREFIX = "/exercises/images";
/** Where `--with-gifs` mirrors the CDN-served GIFs when a local copy is wanted. */
const PUBLIC_VIDEO_PREFIX = "/exercises/videos";

const DOWNLOAD_CONCURRENCY = 8;
const MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 500;

const BODY_PARTS = [
  "back",
  "cardio",
  "chest",
  "lower arms",
  "lower legs",
  "neck",
  "shoulders",
  "upper arms",
  "upper legs",
  "waist",
];

// ---------------------------------------------------------------------------
// Types (mirror packages/exercise-catalog/src/types.ts)
// ---------------------------------------------------------------------------

interface UpstreamExercise {
  id: string;
  name: string;
  body_part: string;
  equipment: string;
  target: string;
  muscle_group: string;
  secondary_muscles: string[];
  instruction_steps: Record<string, string[]>;
  image: string;
  gif_url: string;
  attribution: string;
}

interface CatalogRecord {
  id: string;
  name: string;
  bodyPart: string;
  equipment: string;
  target: string;
  muscleGroup: string;
  secondaryMuscles: string[];
  instructionSteps: { en: string[]; es: string[] };
  imagePath: string;
  gifPath: string;
  attribution: string;
}

interface MediaJob {
  url: string;
  destination: string;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB (${bytes.toLocaleString("en-US")} bytes)`;
}

/** Transient network/5xx failures are retried with exponential backoff. */
async function fetchWithRetry(url: string, label: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      // 4xx (other than 429) is a permanent error — do not burn retries on it.
      if (response.status < 500 && response.status !== 429) {
        throw new Error(`${label}: HTTP ${response.status} ${response.statusText}`);
      }
      lastError = new Error(`${label}: HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("HTTP 4")) {
        throw error;
      }
      lastError = error;
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw new Error(`${label}: failed after ${MAX_ATTEMPTS} attempts — ${String(lastError)}`);
}

/** True when the path already holds a non-empty file. */
async function hasContent(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

/**
 * A plain filename: letters, digits, dot, underscore and hyphen only, and
 * never the traversal names `.` / `..` (both of which are otherwise spelled
 * with allowed characters). Every name in the upstream dataset matches this
 * (verified across all 2648 media files), so the pattern costs nothing
 * legitimate while rejecting path separators, traversal, NUL bytes and
 * shell-significant characters outright.
 */
const PLAIN_FILENAME = /^(?!\.\.?$)[A-Za-z0-9._-]+$/;

/**
 * Last path segment of an UNTRUSTED upstream media path, validated as a plain
 * filename.
 *
 * The return value is joined into a write destination under `IMAGES_DIR` /
 * `VIDEOS_DIR`, so it is a path-traversal sink. Splitting on `/` alone is not
 * enough: on Windows `\` is also a separator, so `images\..\..\evil.js` has a
 * single `/`-segment and would be joined verbatim, escaping the media
 * directory. A bare `..` segment is likewise not a filename and would resolve
 * to the parent directory (EISDIR at best).
 *
 * EVERY segment is checked, not just the last, so a traversal attempt fails
 * loudly at import time instead of being silently normalised away — the
 * dataset is expected to contain plain relative paths, and anything else means
 * the upstream source is not what we think it is.
 */
function basenameOf(relativePath: string): string {
  const segments = relativePath.split(/[/\\]/);
  const last = segments[segments.length - 1];
  if (
    last === undefined ||
    !segments.every((segment) => PLAIN_FILENAME.test(segment))
  ) {
    throw new Error(`Unusable media path in dataset: "${relativePath}"`);
  }
  return last;
}

// ---------------------------------------------------------------------------
// Step A — download the source dataset
// ---------------------------------------------------------------------------

async function downloadDataset(): Promise<UpstreamExercise[]> {
  log(`Downloading dataset from ${DATASET_SOURCE_URL} …`);
  const response = await fetchWithRetry(DATASET_SOURCE_URL, "exercises.json");
  const body = await response.text();
  const parsed: unknown = JSON.parse(body);
  if (!Array.isArray(parsed)) {
    throw new Error("exercises.json did not contain a JSON array");
  }
  log(`  ${parsed.length} upstream records (${formatBytes(Buffer.byteLength(body))})`);
  return parsed as UpstreamExercise[];
}

// ---------------------------------------------------------------------------
// Step B — transform to the trimmed catalog shape
// ---------------------------------------------------------------------------

function requireString(value: unknown, field: string, id: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Record ${id}: missing or blank "${field}"`);
  }
  return value;
}

function requireSteps(value: unknown, locale: string, id: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Record ${id}: missing or empty "${locale}" instruction steps`);
  }
  for (const step of value) {
    if (typeof step !== "string") {
      throw new Error(`Record ${id}: non-string "${locale}" instruction step`);
    }
  }
  return value as string[];
}

function toCatalogRecord(source: UpstreamExercise): CatalogRecord {
  const id = requireString(source.id, "id", String(source.id));
  const bodyPart = requireString(source.body_part, "body_part", id);
  if (!BODY_PARTS.includes(bodyPart)) {
    throw new Error(`Record ${id}: unknown body_part "${bodyPart}"`);
  }
  const steps = source.instruction_steps ?? {};

  return {
    id,
    name: requireString(source.name, "name", id),
    bodyPart,
    equipment: requireString(source.equipment, "equipment", id),
    target: requireString(source.target, "target", id),
    muscleGroup: requireString(source.muscle_group, "muscle_group", id),
    secondaryMuscles: Array.isArray(source.secondary_muscles)
      ? [...source.secondary_muscles]
      : [],
    instructionSteps: {
      en: requireSteps(steps.en, "en", id),
      es: requireSteps(steps.es, "es", id),
    },
    // Self-hosted thumbnail (app-absolute) vs. CDN-served animation (absolute
    // https URL, SHA-pinned) — see the MEDIA STRATEGY note at the top.
    imagePath: `${PUBLIC_IMAGE_PREFIX}/${basenameOf(requireString(source.image, "image", id))}`,
    gifPath: `${GIF_CDN_BASE}/${basenameOf(requireString(source.gif_url, "gif_url", id))}`,
    // Verbatim media copyright notice — MUST NOT be dropped or rewritten.
    attribution: requireString(source.attribution, "attribution", id),
  };
}

function buildCatalog(sources: UpstreamExercise[]): CatalogRecord[] {
  const records = sources.map(toCatalogRecord);
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) {
      throw new Error(`Duplicate exercise id "${record.id}" in dataset`);
    }
    seen.add(record.id);
  }
  // Deterministic order keeps re-runs diff-free.
  records.sort((a, b) => a.id.localeCompare(b.id));
  return records;
}

// ---------------------------------------------------------------------------
// Step C — write the trimmed catalog
// ---------------------------------------------------------------------------

async function writeCatalog(records: CatalogRecord[]): Promise<void> {
  await mkdir(CATALOG_DIR, { recursive: true });
  const serialized = `${JSON.stringify(records, null, 2)}\n`;
  await writeFile(CATALOG_FILE, serialized, "utf8");
  log(`Wrote ${CATALOG_FILE}`);
  log(`  ${records.length} records, ${formatBytes(Buffer.byteLength(serialized))}`);
}

// ---------------------------------------------------------------------------
// Step D — download media with bounded concurrency
// ---------------------------------------------------------------------------

async function downloadOne(job: MediaJob): Promise<"skipped" | "downloaded"> {
  if (await hasContent(job.destination)) {
    return "skipped";
  }
  const response = await fetchWithRetry(job.url, job.url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error(`${job.url}: empty response body`);
  }
  await writeFile(job.destination, bytes);
  return "downloaded";
}

async function downloadMedia(jobs: MediaJob[], label: string): Promise<void> {
  let downloaded = 0;
  let skipped = 0;
  let started = 0;
  const failures: string[] = [];

  async function worker(): Promise<void> {
    for (;;) {
      const index = started;
      started += 1;
      const job = jobs[index];
      if (job === undefined) {
        return;
      }
      try {
        const outcome = await downloadOne(job);
        if (outcome === "downloaded") {
          downloaded += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        failures.push(`${job.url}: ${String(error)}`);
      }
      const done = downloaded + skipped + failures.length;
      if (done % 50 === 0 || done === jobs.length) {
        log(
          `  ${label}: ${done}/${jobs.length} (${downloaded} downloaded, ${skipped} skipped, ${failures.length} failed)`,
        );
      }
    }
  }

  log(`Downloading ${jobs.length} ${label} into ${dirname(jobs[0]?.destination ?? "")} …`);
  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));

  if (failures.length > 0) {
    for (const failure of failures.slice(0, 20)) {
      process.stderr.write(`  FAILED ${failure}\n`);
    }
    throw new Error(`${failures.length} ${label} failed to download`);
  }
}

async function directoryReport(dir: string, extension: string): Promise<void> {
  const entries = await readdir(dir);
  const matching = entries.filter((entry) => entry.endsWith(extension));
  let bytes = 0;
  for (const entry of matching) {
    const stats = await stat(join(dir, entry));
    bytes += stats.size;
  }
  log(`  ${dir}: ${matching.length} ${extension} files, ${formatBytes(bytes)}`);
}

// ---------------------------------------------------------------------------
// Step E — attribution notice shipped next to the media
// ---------------------------------------------------------------------------

const ATTRIBUTION_MARKDOWN = `# Exercise media attribution & license

<!-- Generated by scripts/import-exercise-catalog.ts — do not edit by hand. -->

The exercise **media** (180x180 thumbnails and animation GIFs) is the property
of **Gym visual** and is redistributed under the terms below. It is **not**
covered by kInorA's license.

> **(c) Gym visual — https://gymvisual.com/**

## Where each asset class is served from

kInorA uses a hybrid strategy. **The terms below apply identically to both**;
the delivery mechanism changes nothing about the licensing obligations.

| Asset | Served from | Catalog field |
| --- | --- | --- |
| Thumbnails (JPG) | **Self-hosted** in \`images/\` next to this file, under \`apps/web/public/\` | \`imagePath\`, app-absolute \`/exercises/images/<file>.jpg\` |
| Animations (GIF) | **jsDelivr CDN**, off the upstream repository pinned to commit \`${DATASET_PINNED_SHA}\` | \`gifPath\`, absolute \`${GIF_CDN_BASE}/<file>.gif\` |

The GIFs are CDN-served rather than self-hosted purely to keep ~123 MB out of
the Docker image; they are the same Gym visual files, unmodified and still at
180x180. The CDN URL is pinned to an immutable commit SHA (never a branch) so
the bytes we serve can never change without a reviewed update here.

A local mirror of the GIFs can be recreated at any time with
\`node scripts/import-exercise-catalog.ts --with-gifs\`, which writes them into
\`videos/\` next to this file. The same terms apply to that copy.

## Terms

- **Resolution:** distributed at **180x180 only**. This cap applies to the
  self-hosted thumbnails and to the CDN-served animations alike.
- **Attribution:** every use must carry the copyright indication
  **(c) Gym visual — https://gymvisual.com/**. Every record in
  \`packages/exercise-catalog/data/exercises.catalog.json\` carries a required
  \`attribution\` field with this notice — keep it intact and surface it
  wherever the media is displayed, whether that media is loaded from this
  directory or from the CDN.
- **Reuse:** the media remains the property of Gym visual and its use is
  governed by Gym visual's Terms & Conditions of Use:
  **https://gymvisual.com/content/3-terms-and-conditions-of-use**

Reviewing those terms and, where required, obtaining a license directly from
Gym visual is mandatory for any reuse. Nothing in this repository grants rights
to the media beyond what Gym visual's terms allow. Serving a file through a
public CDN does not place it in the public domain and grants no additional
rights to it.

## Data

The exercise **data** (names, categories, body parts, equipment, targets,
muscle groups and multilingual instructions) is separate from the media and is
released under the MIT License by the
[exercises-dataset](${DATASET_REPO}) project —
MIT (c) 2026 Hasan Emir Yildirim.
`;

async function writeAttribution(): Promise<void> {
  await mkdir(MEDIA_ROOT, { recursive: true });
  await writeFile(ATTRIBUTION_FILE, ATTRIBUTION_MARKDOWN, "utf8");
  log(`Wrote ${ATTRIBUTION_FILE}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const dataOnly = process.argv.includes("--data-only");
  // Opt-in escape hatch: mirror the CDN-served GIFs locally (cold backup, or a
  // self-hosting fallback if jsDelivr ever becomes unavailable). Off by default
  // so ~123 MB never lands in the Docker build context.
  const withGifs = process.argv.includes("--with-gifs");

  const sources = await downloadDataset();
  const records = buildCatalog(sources);
  await writeCatalog(records);
  await writeAttribution();
  log(`GIFs referenced from jsDelivr @ ${DATASET_PINNED_SHA} (not downloaded).`);

  if (dataOnly) {
    log("--data-only: skipping media download.");
    return;
  }

  await mkdir(IMAGES_DIR, { recursive: true });
  const imageJobs: MediaJob[] = sources.map((source) => ({
    url: `${DATASET_RAW_BASE}/${source.image}`,
    destination: join(IMAGES_DIR, basenameOf(source.image)),
  }));
  await downloadMedia(imageJobs, "images");

  log("Media on disk:");
  await directoryReport(IMAGES_DIR, ".jpg");

  if (withGifs) {
    await mkdir(VIDEOS_DIR, { recursive: true });
    const videoJobs: MediaJob[] = sources.map((source) => ({
      // Mirror from the same pinned commit the catalog URLs point at, so the
      // local copy is byte-identical to what production serves.
      url: `${GIF_CDN_BASE}/${basenameOf(source.gif_url)}`,
      destination: join(VIDEOS_DIR, basenameOf(source.gif_url)),
    }));
    await downloadMedia(videoJobs, "videos");
    await directoryReport(VIDEOS_DIR, ".gif");
  } else {
    log(
      "  videos: skipped (CDN-served). Re-run with --with-gifs for a local mirror.",
    );
  }

  log("Done.");
}

// Exported for unit testing only — `basenameOf` guards a path-traversal sink,
// so its rejection rules are asserted directly rather than through a full
// import run.
export { basenameOf };

// Run only when invoked directly as `node scripts/import-exercise-catalog.ts`,
// not when imported by unit tests. Plain-Node ESM has no `import.meta.main`
// yet, so use the path-equality guard (same shape as `e2e-with-stack.mjs`).
// A side-effecting import would otherwise download the whole dataset.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((error: unknown) => {
    process.stderr.write(`import-exercise-catalog failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
