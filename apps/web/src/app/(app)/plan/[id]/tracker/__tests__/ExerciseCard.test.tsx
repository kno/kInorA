// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { catalogs } from "@kinora/i18n";
import type { SessionExerciseRecord, SetRecordDTO } from "@kinora/contracts";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { ExerciseCard } from "../ExerciseCard";

function withIntl(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>
  );
}

// Scoped CSS module — return class names verbatim (queries are by role/text).
vi.mock("../../TrackerPanel.module.css", () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));

function makeExercise(): SessionExerciseRecord {
  return {
    id: "ex-1",
    workoutSessionId: "sess-1",
    exerciseIndex: 0,
    title: "Bench Press",
    restSeconds: 90,
    setRecords: [],
  };
}

function makeSet(overrides?: Partial<SetRecordDTO>): SetRecordDTO {
  return {
    id: "s1",
    sessionExerciseId: "ex-1",
    setIndex: 0,
    targetReps: "8",
    weightKg: 40,
    completed: false,
    ...overrides,
  };
}

function renderCard(props?: {
  activeSet?: SetRecordDTO;
  canRecord?: boolean;
}) {
  const onRecordSet = vi.fn().mockResolvedValue(undefined);
  const onSetCompleted = vi.fn();
  const activeSet = props?.activeSet ?? makeSet();
  const view = renderWithIntl(
    <ExerciseCard
      activeExercise={makeExercise()}
      activeSet={activeSet}
      currentSetNumber={1}
      totalSetsInExercise={1}
      exerciseVolume={0}
      canRecord={props?.canRecord ?? true}
      onRecordSet={onRecordSet}
      onSetCompleted={onSetCompleted}
    />,
  );
  return { onRecordSet, onSetCompleted, ...view };
}

/** Read the LOAD stepper's current displayed value (labelled "Load"). */
function loadValue(): string {
  return screen.getByLabelText("Load").textContent ?? "";
}

const inc = () => screen.getByRole("button", { name: /increase load/i });
const dec = () => screen.getByRole("button", { name: /decrease load/i });
const stepOption = (step: number) =>
  screen.getByRole("button", { name: `Set increment to ${step} kg` });

describe("ExerciseCard — granular load step (#253)", () => {
  it("defaults to a 2.5 kg step: one +press increases load by 2.5", () => {
    renderCard();
    expect(loadValue()).toBe("40");
    fireEvent.click(inc());
    expect(loadValue()).toBe("42.5");
    // The 2.5 option is the pre-selected default.
    expect(stepOption(2.5).getAttribute("aria-pressed")).toBe("true");
  });

  it("selecting the 0.5 option makes +press add 0.5 (and −press subtract 0.5)", () => {
    renderCard();
    fireEvent.click(stepOption(0.5));
    expect(stepOption(0.5).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(inc());
    expect(loadValue()).toBe("40.5");
    fireEvent.click(dec());
    expect(loadValue()).toBe("40");
  });

  it("selecting the 5 option makes +press add 5 (and −press subtract 5)", () => {
    renderCard();
    fireEvent.click(stepOption(5));
    fireEvent.click(inc());
    expect(loadValue()).toBe("45");
    fireEvent.click(dec());
    fireEvent.click(dec());
    expect(loadValue()).toBe("35");
  });

  it("keeps the selected step across an active-set change while re-seeding the weight", () => {
    const { rerender } = renderCard({ activeSet: makeSet({ id: "s1", weightKg: 40 }) });
    fireEvent.click(stepOption(5));
    fireEvent.click(inc()); // 40 -> 45
    expect(loadValue()).toBe("45");

    // A new active set arrives: weight re-seeds to its value, step persists.
    rerender(
      withIntl(
        <ExerciseCard
          activeExercise={makeExercise()}
          activeSet={makeSet({ id: "s2", weightKg: 100 })}
          currentSetNumber={2}
          totalSetsInExercise={2}
          exerciseVolume={0}
          canRecord
          onRecordSet={vi.fn().mockResolvedValue(undefined)}
          onSetCompleted={vi.fn()}
        />,
      ),
    );
    expect(loadValue()).toBe("100"); // re-seeded
    expect(stepOption(5).getAttribute("aria-pressed")).toBe("true"); // step persisted
    fireEvent.click(inc()); // +5 with the persisted step
    expect(loadValue()).toBe("105");
  });

  it("clamps at the 300 kg ceiling", () => {
    renderCard({ activeSet: makeSet({ weightKg: 298 }) });
    fireEvent.click(stepOption(5));
    fireEvent.click(inc()); // 298 + 5 = 303 -> clamped to 300
    expect(loadValue()).toBe("300");
  });

  it("clamps at the 0 kg floor", () => {
    renderCard({ activeSet: makeSet({ weightKg: 2 }) });
    fireEvent.click(stepOption(5));
    fireEvent.click(dec()); // 2 - 5 = -3 -> clamped to 0
    expect(loadValue()).toBe("0");
  });

  it("disables the step selector together with the stepper when recording is blocked", () => {
    renderCard({ canRecord: false });
    expect((inc() as HTMLButtonElement).disabled).toBe(true);
    expect((stepOption(0.5) as HTMLButtonElement).disabled).toBe(true);
    expect((stepOption(5) as HTMLButtonElement).disabled).toBe(true);
  });
});
