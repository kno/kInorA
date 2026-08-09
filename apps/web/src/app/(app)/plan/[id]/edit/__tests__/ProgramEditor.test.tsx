// @vitest-environment jsdom
/**
 * 17d PR D — the program editor's behaviour, not its markup.
 *
 * The assertions that matter are the ones about what leaves the browser and
 * what the user is told when a save does not land: the loaded `version` must
 * come back as `expectedVersion`, a lost race must read differently from a
 * validation failure (the remedies differ), and a program stripped of every
 * day must never reach the network at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import type { WorkoutProgram } from "@kinora/contracts";
import { ProgramEditor } from "../ProgramEditor";
import type { UpdateProgramResult } from "../program-edit-types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const LOADED_VERSION = 3;

function program(): WorkoutProgram {
  return {
    weeklySessions: [
      {
        day: 1,
        title: "Push Day",
        exercises: [{ name: "Bench Press", sets: 3, reps: "8-10", restSeconds: 90 }],
      },
      {
        day: 3,
        title: "Pull Day",
        exercises: [{ name: "Barbell Row", sets: 3, reps: "8-10", restSeconds: 90 }],
      },
    ],
    limitationWarnings: [],
  };
}

function renderEditor(onSave: ReturnType<typeof vi.fn>) {
  renderWithIntl(
    <ProgramEditor
      planId="plan-1"
      planName="Summer Cut"
      program={program()}
      version={LOADED_VERSION}
      onSave={onSave}
    />,
  );
}

function okResult(next: WorkoutProgram): UpdateProgramResult {
  return { kind: "ok", program: next, version: 4 };
}

describe("ProgramEditor (17d PR D)", () => {
  it("loads the current program into the form", () => {
    renderEditor(vi.fn());

    expect(
      (screen.getByTestId("exercise-name-0-0") as HTMLInputElement).value,
    ).toBe("Bench Press");
    expect((screen.getByTestId("day-title-1") as HTMLInputElement).value).toBe("Pull Day");
    expect((screen.getByTestId("day-number-1") as HTMLInputElement).value).toBe("3");
  });

  it("sends the loaded version back as expectedVersion", async () => {
    const onSave = vi.fn().mockResolvedValue(okResult(program()));
    renderEditor(onSave);

    fireEvent.click(screen.getByTestId("save-program"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toBe("plan-1");
    expect(onSave.mock.calls[0]![2]).toBe(LOADED_VERSION);
  });

  it("submits the edited exercise name", async () => {
    const onSave = vi.fn().mockResolvedValue(okResult(program()));
    renderEditor(onSave);

    fireEvent.change(screen.getByTestId("exercise-name-0-0"), {
      target: { value: "Incline Press" },
    });
    fireEvent.click(screen.getByTestId("save-program"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const sent = onSave.mock.calls[0]![1] as WorkoutProgram;
    expect(sent.weeklySessions[0]!.exercises[0]!.name).toBe("Incline Press");
  });

  it("adopts the server's new version so a second save is not a self-conflict", async () => {
    const onSave = vi.fn().mockResolvedValue(okResult(program()));
    renderEditor(onSave);

    fireEvent.click(screen.getByTestId("save-program"));
    await screen.findByTestId("edit-saved");

    fireEvent.change(screen.getByTestId("day-title-0"), { target: { value: "Chest" } });
    fireEvent.click(screen.getByTestId("save-program"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1]![2]).toBe(4);
  });

  it("removing a day rewrites the submitted document — it deletes nothing", async () => {
    const onSave = vi.fn().mockResolvedValue(okResult(program()));
    renderEditor(onSave);

    fireEvent.click(screen.getByTestId("remove-day-1"));
    fireEvent.click(screen.getByTestId("save-program"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const sent = onSave.mock.calls[0]![1] as WorkoutProgram;
    expect(sent.weeklySessions).toHaveLength(1);
    expect(sent.weeklySessions[0]!.day).toBe(1);
  });

  it("blocks a submission that removes every session before any request is made", async () => {
    const onSave = vi.fn();
    renderEditor(onSave);

    fireEvent.click(screen.getByTestId("remove-day-1"));
    fireEvent.click(screen.getByTestId("remove-day-0"));
    fireEvent.click(screen.getByTestId("save-program"));

    const message = await screen.findByTestId("edit-validation");
    expect(message.textContent).toMatch(/at least one training day/i);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("blocks a submission whose day has no exercises left", async () => {
    const onSave = vi.fn();
    renderEditor(onSave);

    fireEvent.click(screen.getByTestId("remove-exercise-0-0"));
    fireEvent.click(screen.getByTestId("save-program"));

    const message = await screen.findByTestId("edit-validation");
    expect(message.textContent).toMatch(/at least one exercise/i);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("renders a conflict distinctly from a validation error, and offers a reload", async () => {
    const onSave = vi
      .fn()
      .mockResolvedValue({ kind: "conflict", currentVersion: 7 });
    renderEditor(onSave);

    fireEvent.click(screen.getByTestId("save-program"));

    const conflict = await screen.findByTestId("edit-conflict");
    expect(conflict.textContent).toMatch(/changed somewhere else/i);
    // Distinct surface, not the validation one — the remedy is different.
    expect(screen.queryByTestId("edit-validation")).toBeNull();

    fireEvent.click(screen.getByTestId("edit-conflict-reload"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("tells the user a generating or failed plan cannot be edited", async () => {
    const onSave = vi.fn().mockResolvedValue({ kind: "not_ready" });
    renderEditor(onSave);

    fireEvent.click(screen.getByTestId("save-program"));

    const notReady = await screen.findByTestId("edit-not-ready");
    expect(notReady.textContent).toMatch(/cannot be edited/i);
    expect(screen.queryByTestId("edit-conflict")).toBeNull();
  });

  it("renders the server's structural issues when it rejects an edit the client accepted", async () => {
    // The server is the source of truth: a rule the client did not catch must
    // still surface as a named issue, not as a generic failure.
    const onSave = vi.fn().mockResolvedValue({ kind: "invalid", issues: ["duplicate_day"] });
    renderEditor(onSave);

    fireEvent.click(screen.getByTestId("save-program"));

    const message = await screen.findByTestId("edit-validation");
    expect(message.textContent).toMatch(/same day of the week/i);
  });

  it("surfaces an unknown failure instead of claiming the program was saved", async () => {
    const onSave = vi.fn().mockResolvedValue({ kind: "error", message: "api_unreachable" });
    renderEditor(onSave);

    fireEvent.click(screen.getByTestId("save-program"));

    expect((await screen.findByTestId("edit-error")).textContent).toMatch(/could not save/i);
    expect(screen.queryByTestId("edit-saved")).toBeNull();
  });

  it("confirms the edit applies to the next session, not to history", async () => {
    const onSave = vi.fn().mockResolvedValue(okResult(program()));
    renderEditor(onSave);

    fireEvent.click(screen.getByTestId("save-program"));

    expect((await screen.findByTestId("edit-saved")).textContent).toMatch(/next session/i);
  });

  it("adds a day on a free day number so the new day is not born duplicated", async () => {
    const onSave = vi.fn().mockResolvedValue(okResult(program()));
    renderEditor(onSave);

    fireEvent.click(screen.getByTestId("add-day"));
    fireEvent.change(screen.getByTestId("exercise-name-2-0"), {
      target: { value: "Squat" },
    });
    fireEvent.click(screen.getByTestId("save-program"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const sent = onSave.mock.calls[0]![1] as WorkoutProgram;
    const days = sent.weeklySessions.map((session) => session.day);
    expect(new Set(days).size).toBe(days.length);
  });

  it("adds an exercise to an existing day", async () => {
    const onSave = vi.fn().mockResolvedValue(okResult(program()));
    renderEditor(onSave);

    fireEvent.click(screen.getByTestId("add-exercise-0"));
    fireEvent.change(screen.getByTestId("exercise-name-0-1"), {
      target: { value: "Dips" },
    });
    fireEvent.click(screen.getByTestId("save-program"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const sent = onSave.mock.calls[0]![1] as WorkoutProgram;
    expect(sent.weeklySessions[0]!.exercises.map((e) => e.name)).toEqual([
      "Bench Press",
      "Dips",
    ]);
  });

  it("carries the stored limitationWarnings through untouched", async () => {
    // They are derived from the spec's limitations, not user-editable copy —
    // and the server ignores whatever the body claims anyway.
    const onSave = vi.fn().mockResolvedValue(okResult(program()));
    renderWithIntl(
      <ProgramEditor
        planId="plan-1"
        program={{ ...program(), limitationWarnings: ["Go easy on the shoulder."] }}
        version={LOADED_VERSION}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByTestId("save-program"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const sent = onSave.mock.calls[0]![1] as WorkoutProgram;
    expect(sent.limitationWarnings).toEqual(["Go easy on the shoulder."]);
  });
});
