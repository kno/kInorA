import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  KinIcon,
  createLibraryIconEntry,
  kinIconRegistry,
  type KinIconName,
} from "..";

describe("KinIcon", () => {
  it("renders known icons with decorative defaults", () => {
    const html = renderToStaticMarkup(<KinIcon name="home" />);

    expect(html).toContain('width="24"');
    expect(html).toContain('height="24"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("renders a semantic title when the icon is not decorative", () => {
    const html = renderToStaticMarkup(
      <KinIcon name="plan" decorative={false} title="Training plan" />,
    );

    expect(html).toContain('role="img"');
    expect(html).toContain("<title>Training plan</title>");
    expect(html).not.toContain('aria-hidden="true"');
  });

  it("falls back to the registry label when no title is provided", () => {
    const html = renderToStaticMarkup(<KinIcon name="create" decorative={false} />);

    expect(html).toContain('aria-label="Create Plan"');
  });

  it("exposes a typed registry for future screen reuse", () => {
    const names = Object.keys(kinIconRegistry) as KinIconName[];

    expect(names).toContain("home");
    expect(names).toContain("stats");
    expect(kinIconRegistry.exercises.label).toBe("Exercises");
  });

  it("models future approved library icon adapters explicitly", () => {
    const adapter = createLibraryIconEntry("Library Trend", {
      library: "approved-library",
      icon: "TrendUp",
      render: ({ className }) => <path className={className} d="M4 18L10 12L14 16L20 8" />,
    });

    expect(adapter.source).toBe("library");
    expect(adapter.library).toBe("approved-library");
    expect(adapter.icon).toBe("TrendUp");
  });
});
