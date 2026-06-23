import { describe, it, expect } from "vitest";
import { resolveDeepLinkAction } from "../deep-link";

describe("resolveDeepLinkAction", () => {
  const allowlist = ["kinora://auth/callback"];

  it("processes a valid kinora:// callback URL that is on the allowlist", () => {
    const action = resolveDeepLinkAction(
      "kinora://auth/callback?code=abc123&state=xyz789",
      allowlist
    );

    expect(action).toEqual({ kind: "process", code: "abc123", state: "xyz789" });
  });

  // Triangle: valid scheme + params, but URL NOT on the allowlist -> ignore
  // (open-redirect guard: an attacker-crafted kinora:// host must be rejected)
  it("ignores a valid kinora:// URL whose host is not on the allowlist", () => {
    const action = resolveDeepLinkAction(
      "kinora://evil/callback?code=abc123&state=xyz789",
      allowlist
    );

    expect(action).toEqual({ kind: "ignore" });
  });

  // Triangle: invalid URL string
  it("ignores an unparseable URL", () => {
    expect(resolveDeepLinkAction("not-a-url", allowlist)).toEqual({ kind: "ignore" });
  });

  // Triangle: wrong scheme (e.g. https) -> ignore
  it("ignores a URL that does not use the kinora scheme", () => {
    expect(
      resolveDeepLinkAction(
        "https://kinora.app/auth/callback?code=c&state=s",
        allowlist
      )
    ).toEqual({ kind: "ignore" });
  });

  // Triangle: missing code
  it("ignores a callback URL missing the code parameter", () => {
    expect(
      resolveDeepLinkAction("kinora://auth/callback?state=xyz789", allowlist)
    ).toEqual({ kind: "ignore" });
  });

  // Triangle: missing state
  it("ignores a callback URL missing the state parameter", () => {
    expect(
      resolveDeepLinkAction("kinora://auth/callback?code=abc123", allowlist)
    ).toEqual({ kind: "ignore" });
  });

  // Triangle: extra query params but allowlist base matches -> still process
  it("processes a URL with extra query params when the allowlist base matches", () => {
    const action = resolveDeepLinkAction(
      "kinora://auth/callback?code=c&state=s&extra=1",
      allowlist
    );

    expect(action).toEqual({ kind: "process", code: "c", state: "s" });
  });

  // Triangle: empty allowlist -> nothing is ever processed
  it("ignores every URL when the allowlist is empty", () => {
    expect(
      resolveDeepLinkAction("kinora://auth/callback?code=c&state=s", [])
    ).toEqual({ kind: "ignore" });
  });
});
