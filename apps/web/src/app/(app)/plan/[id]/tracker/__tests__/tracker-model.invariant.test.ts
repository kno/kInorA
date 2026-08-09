/**
 * 17d PR D — the tracker renders the DB snapshot, never the plan.
 *
 * Someone can now edit a program while a session against it is in progress.
 * That is safe today for a structural reason, not a conventional one:
 * `deriveTrackerModel` takes a `WorkoutSessionRecord` and reads
 * `session.exercises` — the `session_exercises` rows written when the session
 * started. `WorkoutSessionRecord` has no program member at all, so there is no
 * channel by which `program_json` could reach a live workout. Adding one would
 * take three deliberate edits: a field on the contract, a mapping in the
 * repository, and a read here.
 *
 * This guard covers only the third of those. It is a LINT pinning a structural
 * guarantee, not a type: it scans source text, so a rename defeats it, and the
 * real protection remains the missing field on the record. It sits in the same
 * family as `migration-journal.test.ts` — cheap coverage for a class of change
 * that would otherwise fail silently, here by quietly rewriting someone's live
 * workout mid-set.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TRACKER_MODEL = join(here, "..", "tracker-model.ts");

describe("tracker-model program invariant (17d PR D)", () => {
  const source = readFileSync(TRACKER_MODEL, "utf8");

  it("reads a source file that is actually there, so a bad read is not a silent pass", () => {
    // Without this, an unreadable/empty file would make the assertion below
    // vacuously true — the same trap `button-modifiers.test.ts` guards against.
    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain("deriveTrackerModel");
  });

  it("never references the stored program", () => {
    expect(source).not.toMatch(/programJson|WorkoutProgram|plan\.program/);
  });

  it("derives the session from the record's own exercise snapshot", () => {
    // The positive half of the same invariant: the tracker's input is the
    // snapshot, so an edit landing mid-session cannot reach it.
    expect(source).toContain("session.exercises");
  });
});
