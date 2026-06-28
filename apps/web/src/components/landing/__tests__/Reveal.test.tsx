import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Reveal } from "../Reveal";

describe("Reveal", () => {
  it("renders children with kin-landing-reveal class", () => {
    const html = renderToStaticMarkup(<Reveal><p>Hello</p></Reveal>);
    expect(html).toContain("kin-landing-reveal");
    expect(html).toContain("Hello");
  });

  it("renders as div by default", () => {
    const html = renderToStaticMarkup(<Reveal><span>X</span></Reveal>);
    expect(html).toMatch(/^<div\b/);
  });

  it("renders as custom tag via as prop", () => {
    const html = renderToStaticMarkup(<Reveal as="section"><span>Y</span></Reveal>);
    expect(html).toMatch(/^<section\b/);
  });

  it("merges additional className", () => {
    const html = renderToStaticMarkup(<Reveal className="extra"><span>Z</span></Reveal>);
    expect(html).toContain("kin-landing-reveal extra");
  });
});
