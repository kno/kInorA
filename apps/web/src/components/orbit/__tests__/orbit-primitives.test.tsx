import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  OrbitCard,
  OrbitCtaSurface,
  OrbitEmptyState,
  OrbitMetricBlock,
  OrbitNavAffordance,
  OrbitSectionHeader,
} from "..";

describe("Orbit primitives", () => {
  it("renders a section header with title, description, and action content", () => {
    const html = renderToStaticMarkup(
      <OrbitSectionHeader
        eyebrow="Orbit"
        title="Weekly momentum"
        description="Stay aligned with the Open Design reference."
        actions={<a href="/stats">Open stats</a>}
      />,
    );

    expect(html).toContain("Weekly momentum");
    expect(html).toContain("Stay aligned with the Open Design reference.");
    expect(html).toContain('href="/stats"');
  });

  it("renders a metric block with semantic value content", () => {
    const html = renderToStaticMarkup(
      <OrbitMetricBlock label="Completion" value="72%" hint="3 of 4 sessions" />,
    );

    expect(html).toContain("Completion");
    expect(html).toContain("72%");
    expect(html).toContain("3 of 4 sessions");
  });

  it("renders navigation affordances as links when href is provided", () => {
    const html = renderToStaticMarkup(
      <OrbitNavAffordance
        href="/plan"
        label="Open weekly plan"
        description="Review the next training block."
      />,
    );

    expect(html).toContain('href="/plan"');
    expect(html).toContain("Open weekly plan");
    expect(html).toContain("Review the next training block.");
  });

  it("renders OrbitEmptyState with a section root", () => {
    const html = renderToStaticMarkup(
      <OrbitEmptyState
        title="No workouts yet"
        description="Your first plan will appear here."
        action={<a href="/create-plan">Create plan</a>}
      />,
    );

    expect(html).toMatch(/^<section\b/);
    expect(html).toContain("No workouts yet");
    expect(html).toContain('href="/create-plan"');
  });

  it("renders OrbitCtaSurface with a section root", () => {
    const html = renderToStaticMarkup(
      <OrbitCtaSurface
        eyebrow="Ready"
        title="Create your next plan"
        description="Keep the Orbit foundation focused on visual reuse."
        actions={<a href="/create-plan">Start now</a>}
      />,
    );

    expect(html).toMatch(/^<section\b/);
    expect(html).toContain("Create your next plan");
    expect(html).toContain('href="/create-plan"');
  });

  it("renders CTA surface children before the content stack", () => {
    const html = renderToStaticMarkup(
      <OrbitCtaSurface
        title="Create your next plan"
        description="Keep the Orbit foundation focused on visual reuse."
        actions={<a href="/create-plan">Start now</a>}
      >
        <div data-proof="glow" />
      </OrbitCtaSurface>,
    );

    expect(html).toContain('data-proof="glow"');
    expect(html.indexOf('data-proof="glow"')).toBeLessThan(html.indexOf("Create your next plan"));
  });

  it("keeps OrbitCard defaulting to an article root", () => {
    const html = renderToStaticMarkup(
      <OrbitCard>
        <p>Card content</p>
      </OrbitCard>,
    );

    expect(html).toMatch(/^<article\b/);
    expect(html).toContain("Card content");
  });
});
