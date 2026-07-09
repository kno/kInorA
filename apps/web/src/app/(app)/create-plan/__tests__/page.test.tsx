// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

const cookieGet = vi.fn();
const loadCurrentDraft = vi.fn();
const getTranslations = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}));

// CreatePlanPage is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
vi.mock("next-intl/server", () => ({
  getTranslations: (...args: unknown[]) => getTranslations(...args),
}));

vi.mock("../actions", () => ({
  saveDraftAction: vi.fn(),
  confirmPlanSpecAction: vi.fn(),
}));

vi.mock("../plan-draft-client", () => ({
  loadCurrentDraft: (...args: unknown[]) => loadCurrentDraft(...args),
}));

// Stub StepperShell so the page test asserts wiring, not the shell internals.
vi.mock("../StepperShell", () => ({
  StepperShell: (props: AnyProps) => ({
    type: "StepperShell",
    props,
    key: null,
  }) as unknown as ReactElement,
}));

import CreatePlanPage from "../page";

afterEach(() => {
  vi.clearAllMocks();
});

describe("CreatePlanPage", () => {
  it("resolves copy server-side via next-intl's getTranslations (not resolvePageI18n)", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    loadCurrentDraft.mockResolvedValue(null);
    getTranslations.mockResolvedValue(() => "");

    await CreatePlanPage();

    expect(getTranslations).toHaveBeenCalled();
  });

  it("does NOT thread a messages prop to StepperShell", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    loadCurrentDraft.mockResolvedValue(null);
    getTranslations.mockResolvedValue(() => "");

    const page = (await CreatePlanPage()) as AnyElement;

    expect(page.props.messages).toBeUndefined();
  });

  it("hydrates the stepper with the current server draft when one exists", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    loadCurrentDraft.mockResolvedValue({ step: 3, spec: { goal: "strength" } });
    getTranslations.mockResolvedValue(() => "");

    const page = (await CreatePlanPage()) as AnyElement;

    expect(loadCurrentDraft).toHaveBeenCalledWith("tok-1");
    expect(page.props.initialDraft).toEqual({ step: 3, spec: { goal: "strength" } });
    expect(page.props.saveDraftAction).toBeDefined();
    expect(page.props.confirmPlanSpecAction).toBeDefined();
  });

  it("starts the stepper with no draft when the API has none", async () => {
    cookieGet.mockReturnValue({ value: "tok-2" });
    loadCurrentDraft.mockResolvedValue(null);
    getTranslations.mockResolvedValue(() => "");

    const page = (await CreatePlanPage()) as AnyElement;

    expect(page.props.initialDraft).toBeUndefined();
  });

  it("passes an undefined token when no session cookie is present", async () => {
    cookieGet.mockReturnValue(undefined);
    loadCurrentDraft.mockResolvedValue(null);
    getTranslations.mockResolvedValue(() => "");

    await CreatePlanPage();

    expect(loadCurrentDraft).toHaveBeenCalledWith(undefined);
  });
});
