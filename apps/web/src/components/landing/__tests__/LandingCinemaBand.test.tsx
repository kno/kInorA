import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingCinemaBand } from "../LandingCinemaBand";

describe("LandingCinemaBand", () => {
  const alt = "Atleta tomando un descanso activo";

  it("renders with role=presentation", () => {
    const html = renderToStaticMarkup(<LandingCinemaBand alt={alt} />);
    expect(html).toContain('role="presentation"');
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
