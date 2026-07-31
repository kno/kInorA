import { describe, it, expect } from "vitest";
import { selectActiveTenant } from "../tenant-selection.js";

/**
 * 15a-v2-trainer-account-access, Slice 3, task 3.7 — the minimal
 * active-tenant-selection enabler. Once a client accepts a trainer's invite
 * they have TWO active memberships (personal tenant + the trainer's tenant).
 * This pure function is the primitive a caller CAN use to pick among them; it
 * is NOT yet wired into the default login path (see doc comment in
 * tenant-selection.ts) — the client-facing tenant switch UI is deferred to a
 * follow-up (S5 scope).
 */
describe("selectActiveTenant", () => {
  const PERSONAL = { tenantId: "personal-tenant" };
  const TRAINER = { tenantId: "trainer-tenant" };

  it("returns the only membership when there is exactly one", () => {
    expect(selectActiveTenant([PERSONAL])).toEqual(PERSONAL);
  });

  it("returns null when there are no active memberships", () => {
    expect(selectActiveTenant([])).toBeNull();
  });

  it("with no preference, returns the first membership (unchanged default behavior)", () => {
    expect(selectActiveTenant([PERSONAL, TRAINER])).toEqual(PERSONAL);
  });

  it("returns the preferred tenant when it is present among the active memberships", () => {
    expect(selectActiveTenant([PERSONAL, TRAINER], "trainer-tenant")).toEqual(TRAINER);
  });

  it("falls back to the first membership when the preferred tenant is not among them", () => {
    expect(selectActiveTenant([PERSONAL, TRAINER], "some-other-tenant")).toEqual(PERSONAL);
  });
});
