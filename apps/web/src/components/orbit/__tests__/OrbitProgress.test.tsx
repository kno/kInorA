// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OrbitProgress } from "../OrbitProgress";

const C = 2 * Math.PI * 16; // circumference ≈ 100.53

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * OrbitProgress replicates the authoritative `icons.html` progress-ring
 * mechanic: a gray arc grown from 12 o'clock via stroke-dashoffset and a
 * lime ball at the arc head rotated by p*360deg, plus a center readout.
 *
 * Assertions verify the geometry (the math that drives the visual) and the
 * progressbar a11y contract — behavior, not Tailwind class names.
 */
describe("OrbitProgress", () => {
  it("exposes the progressbar role with value bounds from value/max", () => {
    render(<OrbitProgress value={25} max={100} aria-label="Loading" />);
    const bar = screen.getByRole("progressbar", { name: "Loading" });
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
  });

  it("sets the arc stroke-dashoffset to C*(1-p) for the given progress", () => {
    const { container } = render(
      <OrbitProgress value={25} max={100} aria-label="Quarter" />,
    );
    const arc = container.querySelector('[data-orbit="arc"]') as SVGElement;
    expect(arc).not.toBeNull();
    // p = 0.25 → dashoffset = C * 0.75 (jsdom may drop trailing zeros, so
    // compare the numeric value, not the formatted string)
    expect(parseFloat(arc.style.strokeDashoffset)).toBeCloseTo(C * 0.75, 1);
    expect(parseFloat(arc.style.strokeDasharray)).toBeCloseTo(C, 1);
  });

  it("rotates the ball <g> by p*360deg at the arc head", () => {
    const { container } = render(
      <OrbitProgress value={25} max={100} aria-label="Quarter" />,
    );
    const ball = container.querySelector('[data-orbit="ball"]') as SVGElement;
    expect(ball).not.toBeNull();
    // p = 0.25 → rotate(90deg)
    expect(ball.style.transform).toBe("rotate(90deg)");
  });

  it("computes a DIFFERENT geometry for a different value (triangulation)", () => {
    const { container } = render(
      <OrbitProgress value={3} max={4} aria-label="Three quarters" />,
    );
    const arc = container.querySelector('[data-orbit="arc"]') as SVGElement;
    const ball = container.querySelector('[data-orbit="ball"]') as SVGElement;
    // p = 0.75 → dashoffset = C * 0.25, rotate(270deg)
    expect(parseFloat(arc.style.strokeDashoffset)).toBeCloseTo(C * 0.25, 1);
    expect(ball.style.transform).toBe("rotate(270deg)");
  });

  it("clamps p into [0,1] when value exceeds max", () => {
    const { container } = render(
      <OrbitProgress value={150} max={100} aria-label="Over" />,
    );
    const arc = container.querySelector('[data-orbit="arc"]') as SVGElement;
    const ball = container.querySelector('[data-orbit="ball"]') as SVGElement;
    expect(parseFloat(arc.style.strokeDashoffset)).toBeCloseTo(0, 1);
    expect(ball.style.transform).toBe("rotate(360deg)");
  });

  it("renders the rounded percent when showPercent is set", () => {
    render(<OrbitProgress value={1} max={3} showPercent aria-label="Pct" />);
    // 1/3 → 33%
    expect(screen.getByText("33")).toBeTruthy();
  });

  it("renders the label caption under the readout when provided", () => {
    render(
      <OrbitProgress value={1} max={3} showPercent label="Session" aria-label="Pct" />,
    );
    expect(screen.getByText("Session")).toBeTruthy();
  });

  it("renders children as the center readout, overriding showPercent", () => {
    render(
      <OrbitProgress value={1} max={5} showPercent aria-label="Step">
        2 / 6
      </OrbitProgress>,
    );
    expect(screen.getByText("2 / 6")).toBeTruthy();
    // showPercent number must NOT appear when children override it
    expect(screen.queryByText("20")).toBeNull();
  });

  it("omits aria-valuenow and marks busy when indeterminate", () => {
    render(<OrbitProgress indeterminate aria-label="Loading" />);
    const bar = screen.getByRole("progressbar", { name: "Loading" });
    expect(bar.getAttribute("aria-valuenow")).toBeNull();
    expect(bar.getAttribute("aria-busy")).toBe("true");
  });

  it("sets svg width and height from the size prop", () => {
    const { container } = render(
      <OrbitProgress value={0} max={100} size={64} aria-label="Sized" />,
    );
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("width")).toBe("64");
    expect(svg.getAttribute("height")).toBe("64");
  });

  it("removes the arc/ball transitions under prefers-reduced-motion", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList);

    const { container } = render(
      <OrbitProgress value={25} max={100} aria-label="Reduced" />,
    );
    const arc = container.querySelector('[data-orbit="arc"]') as SVGElement;
    const ball = container.querySelector('[data-orbit="ball"]') as SVGElement;
    expect(arc.style.transition).toBe("none");
    expect(ball.style.transition).toBe("none");
  });
});
