/**
 * Shared render helpers for the tracker presentational-component tests.
 *
 * Mirrors the convention in `screens/__tests__/WorkoutTrackerScreen.test.tsx`:
 * render the REAL component tree through a real `IntlProvider` seeded with the
 * `@kinora/i18n` catalog, then assert on the flattened *rendered* output (what
 * actually reaches the screen) rather than the instance tree. Not named
 * `*.test.tsx`, so Vitest does not collect it as a suite.
 */
import React from "react";
import { act, create } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { resolveMessages } from "../../../i18n/locale.js";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

export function renderWithIntl(
  ui: React.ReactElement,
  locale: "en" | "es" = "en",
): ReturnType<typeof create> {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <IntlProvider locale={locale} defaultLocale="en" messages={resolveMessages(locale)}>
        {ui}
      </IntlProvider>,
    );
  });
  return renderer;
}

function flattenText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    node.forEach((child) => flattenText(child, out));
  } else if (typeof node === "object" && "children" in (node as any)) {
    flattenText((node as any).children, out);
  }
  return out;
}

export function renderedText(renderer: ReturnType<typeof create>): string {
  return flattenText(renderer.toJSON()).join("");
}

/** Collect every node whose `type` matches, for structural/prop assertions. */
export function findAllByType(renderer: ReturnType<typeof create>, type: string): any[] {
  const out: any[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === type) out.push(node);
    if (node.children) node.children.forEach(walk);
  };
  walk(renderer.toJSON());
  return out;
}
