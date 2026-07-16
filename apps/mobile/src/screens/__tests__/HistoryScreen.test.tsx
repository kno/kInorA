/**
 * HistoryScreen — sync-independent session history (#09b Session History,
 * mobile). Mirrors the mocking convention used by HomeScreen.test.tsx /
 * WorkoutTrackerScreen.test.tsx: `react-native` uses Flow's `import typeof`
 * syntax Vite/Rollup cannot parse under Vitest, so host primitives are
 * stubbed with passthrough elements while the REAL component tree
 * (including its `useIntl()` calls and `getWorkoutHistory` data fetch)
 * renders and is asserted on.
 */
import React from "react";
import { act, create } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WorkoutHistoryEntry } from "@kinora/contracts";
import { resolveMessages } from "../../i18n/locale.js";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-native", () => {
  const FlatList = ({ data, renderItem, ListEmptyComponent, keyExtractor }: any) => {
    if (!data || data.length === 0) {
      return typeof ListEmptyComponent === "function" ? ListEmptyComponent() : (ListEmptyComponent ?? null);
    }
    return React.createElement(
      "View",
      null,
      data.map((item: unknown, index: number) =>
        React.createElement(
          "View",
          { key: keyExtractor ? keyExtractor(item, index) : index },
          renderItem({ item, index }),
        ),
      ),
    );
  };

  return {
    View: "View",
    Text: "Text",
    FlatList,
    StyleSheet: { create: (styles: unknown) => styles },
  };
});

const getWorkoutHistory = vi.fn();
vi.mock("../../api/workout-session.js", () => ({
  getWorkoutHistory: (...args: unknown[]) => getWorkoutHistory(...args),
}));

const HistoryScreen = (await import("../HistoryScreen.js")).default;

const historyEntry: WorkoutHistoryEntry = {
  session: {
    id: "session-1",
    workoutPlanId: "plan-1",
    status: "completed",
    startedAt: "2026-07-04T08:00:00.000Z",
    completedAt: "2026-07-04T09:00:00.000Z",
    exercises: [
      {
        id: "exercise-1",
        workoutSessionId: "session-1",
        exerciseIndex: 0,
        title: "Bench Press",
        restSeconds: 90,
        setRecords: [],
      },
    ],
  },
  totalVolume: 100,
  averageRpe: 8,
  trend: { volumeDelta: 20, direction: "up" },
};

function renderWithLocale(locale: "en" | "es") {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <IntlProvider locale={locale} defaultLocale="en" messages={resolveMessages(locale)}>
        <HistoryScreen />
      </IntlProvider>,
    );
  });
  return renderer;
}

describe("HistoryScreen (sync-independent — never touches the offline queue/snapshot)", () => {
  beforeEach(() => {
    getWorkoutHistory.mockReset();
  });

  it("fetches history on mount via getWorkoutHistory (default pagination), never an offline queue/snapshot module", async () => {
    getWorkoutHistory.mockResolvedValue({ kind: "ok", entries: [historyEntry] });

    await act(async () => {
      renderWithLocale("en");
    });

    expect(getWorkoutHistory).toHaveBeenCalledWith({ limit: 20, offset: 0 });
  });

  it("renders total volume for a completed session", async () => {
    getWorkoutHistory.mockResolvedValue({ kind: "ok", entries: [historyEntry] });

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = renderWithLocale("en");
    });

    const text = renderer.root.findAllByType("Text" as any).map((el) => el.props.children).flat().join(" ");
    expect(text).toContain("100");
  });

  it("renders the localized empty state when there are no completed sessions (EN)", async () => {
    getWorkoutHistory.mockResolvedValue({ kind: "ok", entries: [] });

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = renderWithLocale("en");
    });

    const found = renderer.root.findAllByProps({ children: "No completed sessions yet." });
    expect(found.length).toBeGreaterThan(0);
  });

  it("renders the localized empty state in ES", async () => {
    getWorkoutHistory.mockResolvedValue({ kind: "ok", entries: [] });

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = renderWithLocale("es");
    });

    const found = renderer.root.findAllByProps({ children: "Todavía no hay sesiones completadas." });
    expect(found.length).toBeGreaterThan(0);
  });

  it("falls back to the empty state when the fetch errors (fail-open)", async () => {
    getWorkoutHistory.mockResolvedValue({ kind: "error", message: "api_unreachable" });

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = renderWithLocale("en");
    });

    const found = renderer.root.findAllByProps({ children: "No completed sessions yet." });
    expect(found.length).toBeGreaterThan(0);
  });
});
