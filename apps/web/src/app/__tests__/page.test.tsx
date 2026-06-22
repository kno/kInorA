import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { headers } from "next/headers";
import HomePage from "../page";

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

const mockedHeaders = vi.mocked(headers);

describe("HomePage", () => {
  beforeEach(() => {
    mockedHeaders.mockResolvedValue(new Headers({ "accept-language": "es-ES,es;q=0.9" }));
  });

  it("renders English homepage copy when lang=en is requested", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({ lang: "en" }) });

    expect(hasText(page, "kInorA")).toBe(true);
    expect(hasText(page, "Personalized training powered by AI")).toBe(true);
    expect(hasText(page, "Get Started")).toBe(true);
  });

  it("uses the first lang value when multiple lang query values are present", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({ lang: ["en", "es"] }) });

    expect(hasText(page, "Personalized training powered by AI")).toBe(true);
  });

  it("uses Accept-Language when no lang query value is present", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });

    expect(hasText(page, "Entrenamiento personalizado con IA")).toBe(true);
  });
});

function hasText(node: ReactNode, expected: string): boolean {
  if (typeof node === "string") {
    return node === expected;
  }

  if (Array.isArray(node)) {
    return node.some((child) => hasText(child, expected));
  }

  if (isReactElement(node)) {
    return hasText(node.props.children, expected);
  }

  return false;
}

function isReactElement(node: ReactNode): node is ReactElement<{ children?: ReactNode }> {
  return typeof node === "object" && node !== null && "props" in node;
}
