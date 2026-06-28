import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingCinemaBand } from "../LandingCinemaBand";

describe("LandingCinemaBand", () => {
  const alt = "Atleta tomando un descanso activo";

  it("does NOT use role=presentation on the wrapper (descriptive alt already provides context)", () => {
    // role="presentation" on a wrapper while the child img has a meaningful alt is misleading:
    // the meaningful alt conveys content but role=presentation tells AT to ignore it.
    // Drop the role; let the descriptive alt do its job.
    const html = renderToStaticMarkup(<LandingCinemaBand alt={alt} />);
    expect(html).not.toContain('role="presentation"');
  });

  it("renders a picture element with two sources", () => {
    const html = renderToStaticMarkup(<LandingCinemaBand alt={alt} />);
    expect(html).toContain("<picture");
    expect(html).toContain("rest-set-1600.webp");
    expect(html).toContain("rest-set-800.webp");
  });

  it("renders the alt text on the img", () => {
    const html = renderToStaticMarkup(<LandingCinemaBand alt={alt} />);
    expect(html).toContain(alt);
  });

  it("uses lazy loading", () => {
    const html = renderToStaticMarkup(<LandingCinemaBand alt={alt} />);
    expect(html).toContain('loading="lazy"');
  });
});
