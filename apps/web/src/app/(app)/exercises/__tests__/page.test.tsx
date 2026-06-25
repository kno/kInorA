import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import ExercisesPage from "../page";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("ExercisesPage", () => {
  it("renders the exercises heading", async () => {
    const page = await ExercisesPage();
    expect(textOf(page)).toContain("Exercises");
  });

  it("renders placeholder description text", async () => {
    const page = await ExercisesPage();
    expect(textOf(page)).toContain("exercise library");
  });

  it("renders inside a kin-page wrapper", async () => {
    const page = await ExercisesPage();
    const main = findFirst(page, (el) => el.type === "main");
    expect(main).toBeDefined();
    expect(main?.props?.className).toContain("kin-page");
  });
});

// --- React tree inspection helpers ---

function findFirst(
  node: ReactNode,
  match: (el: AnyElement) => boolean,
): AnyElement | undefined {
  if (isReactElement(node)) {
    if (match(node)) return node;
    const inChildren = findFirst(node.props.children, match);
    if (inChildren) return inChildren;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findFirst(child, match);
      if (found) return found;
    }
  }
  return undefined;
}

function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isReactElement(node)) return textOf(node.props.children);
  return "";
}

function isReactElement(node: ReactNode): node is AnyElement {
  return typeof node === "object" && node !== null && "props" in node;
}
