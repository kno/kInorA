import { describe, it, expect } from "vitest";
import { renderTemplate, templateVariablesOf, TEMPLATE_MARKER_OPEN } from "../prompt-template.js";

describe("renderTemplate", () => {
  it("substitutes a single {{variable}} with its value", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "world" })).toBe("Hello world!");
  });

  it("substitutes every occurrence of a repeated variable", () => {
    expect(renderTemplate("{{x}} and {{x}} again", { x: "A" })).toBe("A and A again");
  });

  it("substitutes an empty-string variable with nothing", () => {
    expect(renderTemplate("before[{{gap}}]after", { gap: "" })).toBe("before[]after");
  });

  it("leaves an unknown {{marker}} intact when no matching variable is supplied", () => {
    expect(renderTemplate("{{known}} {{unknown}}", { known: "yes" })).toBe("yes {{unknown}}");
  });

  it("returns the template unchanged when it has no markers", () => {
    expect(renderTemplate("plain text, no markers here", {})).toBe("plain text, no markers here");
  });

  it("is pure — the same inputs produce the same output", () => {
    const template = "{{a}}-{{b}}-{{a}}";
    const variables = { a: "1", b: "2" };
    expect(renderTemplate(template, variables)).toBe(renderTemplate(template, variables));
  });
});

describe("templateVariablesOf", () => {
  it("extracts every distinct {{variable}} name referenced in the template", () => {
    expect(templateVariablesOf("{{a}} then {{b}} then {{a}} again")).toEqual(["a", "b"]);
  });

  it("returns an empty array for a template with no markers", () => {
    expect(templateVariablesOf("no markers here")).toEqual([]);
  });
});

describe("TEMPLATE_MARKER_OPEN", () => {
  it("is the literal opening delimiter", () => {
    expect(TEMPLATE_MARKER_OPEN).toBe("{{");
  });
});
