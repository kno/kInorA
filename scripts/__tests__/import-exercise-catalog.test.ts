import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { basenameOf } from "../import-exercise-catalog.ts";

/**
 * `basenameOf` guards a path-traversal sink: its return value is joined into a
 * write destination under the media directories (#344, item 5). These tests
 * pin the rejection rules directly — the importer itself is not exercised here
 * (it downloads the upstream dataset).
 */
describe("basenameOf", () => {
  it("returns the last segment of a plain relative path", () => {
    expect(basenameOf("images/0001-abc.jpg")).toBe("0001-abc.jpg");
    expect(basenameOf("0001-abc.jpg")).toBe("0001-abc.jpg");
    expect(basenameOf("a/b/c/0001_abc.gif")).toBe("0001_abc.gif");
  });

  it("rejects a backslash-separated traversal that a /-only split would miss", () => {
    // On Windows this is `images\..\..\evil.js` — a single `/`-segment, so a
    // `/`-only split would return it verbatim and `join` would escape the
    // media directory.
    expect(() => basenameOf("images\\..\\..\\evil.js")).toThrow(/Unusable media path/);
  });

  it("rejects a forward-slash traversal segment", () => {
    expect(() => basenameOf("images/../../evil.js")).toThrow(/Unusable media path/);
  });

  it("rejects a bare traversal segment as the filename", () => {
    expect(() => basenameOf("images/..")).toThrow(/Unusable media path/);
    expect(() => basenameOf("images/.")).toThrow(/Unusable media path/);
    expect(() => basenameOf("..")).toThrow(/Unusable media path/);
  });

  it("rejects empty, trailing-separator and whitespace-only paths", () => {
    expect(() => basenameOf("")).toThrow(/Unusable media path/);
    expect(() => basenameOf("images/")).toThrow(/Unusable media path/);
    expect(() => basenameOf("images\\")).toThrow(/Unusable media path/);
    expect(() => basenameOf("   ")).toThrow(/Unusable media path/);
  });

  it("rejects absolute paths, which would ignore the media directory entirely", () => {
    expect(() => basenameOf("/etc/passwd")).toThrow(/Unusable media path/);
    expect(() => basenameOf("C:\\Windows\\evil.js")).toThrow(/Unusable media path/);
  });

  it("rejects names carrying a NUL byte or other non-plain characters", () => {
    expect(() => basenameOf("images/evil\0.jpg")).toThrow(/Unusable media path/);
    expect(() => basenameOf("images/ev il.jpg")).toThrow(/Unusable media path/);
    expect(() => basenameOf("images/$(whoami).jpg")).toThrow(/Unusable media path/);
  });

  it("keeps every accepted name inside the destination directory when joined", () => {
    const dir = "/tmp/exercise-media";
    for (const path of ["images/0001-abc.jpg", "a/b/0002_x.gif", "0003.jpg"]) {
      expect(join(dir, basenameOf(path)).startsWith(`${dir}/`)).toBe(true);
    }
  });
});
