import { describe, it, expect } from "vitest";
import {
  TRACE_REDACTION_RULES,
  redactSpans,
  redactTracedPayload,
  isRedactionVerified,
  type TraceRedactionRule,
} from "../trace-redaction.js";

describe("redactSpans — the registered rule set", () => {
  it("empties the content of a registered span, leaving delimiters and surrounding text byte-identical", () => {
    const text = "before <body_profile>68kg, 172cm</body_profile> after";
    expect(redactSpans(text)).toBe("before <body_profile>[REDACTED]</body_profile> after");
  });

  it("passes a string with no matching span through unchanged", () => {
    const text = "Session duration: 68 minutes";
    expect(redactSpans(text)).toBe(text);
  });

  it("handles repeated occurrences of the same span", () => {
    const text = "<body_profile>A</body_profile> mid <body_profile>B</body_profile>";
    expect(redactSpans(text)).toBe(
      "<body_profile>[REDACTED]</body_profile> mid <body_profile>[REDACTED]</body_profile>",
    );
  });

  it("fails closed: an unterminated open marker redacts to end-of-string", () => {
    const text = "before <body_profile>68kg, 172cm, no closing tag ever";
    expect(redactSpans(text)).toBe("before <body_profile>[REDACTED]");
  });
});

describe("redactSpans — composed rules (nesting, injectable rule list)", () => {
  const rules: TraceRedactionRule[] = [
    { open: "<body_profile>", close: "</body_profile>" },
    { open: "<user_message>", close: "</user_message>" },
  ];

  it("redacts two different registered spans independently, proving future composition (e.g. #374) is additive", () => {
    const text = "<body_profile>68kg</body_profile> said: <user_message>my knee hurts</user_message>";
    expect(redactSpans(text, rules)).toBe(
      "<body_profile>[REDACTED]</body_profile> said: <user_message>[REDACTED]</user_message>",
    );
  });

  it("redacts an outer span even when it fully contains an inner span with the same delimiters", () => {
    const text = "<body_profile>outer <body_profile>inner</body_profile> tail</body_profile>";
    // The rule matches the FIRST closing marker after the opener — the whole
    // outer span content up to and including the inner close is redacted as
    // one unit, and no unrelated text after it is ever left unscanned by a
    // later rule pass.
    const redacted = redactSpans(text, [rules[0]!]);
    expect(redacted.startsWith("<body_profile>[REDACTED]</body_profile>")).toBe(true);
    expect(redacted).not.toContain("outer");
    expect(redacted).not.toContain("inner");
  });
});

describe("redactTracedPayload — the MaskFunction shape Langfuse expects", () => {
  it("redacts a plain string payload", () => {
    expect(redactTracedPayload({ data: "<body_profile>68kg</body_profile>" })).toBe(
      "<body_profile>[REDACTED]</body_profile>",
    );
  });

  it("walks an array of strings", () => {
    expect(
      redactTracedPayload({ data: ["<body_profile>68kg</body_profile>", "no span here"] }),
    ).toEqual(["<body_profile>[REDACTED]</body_profile>", "no span here"]);
  });

  it("walks a plain object, redacting nested string values only", () => {
    expect(
      redactTracedPayload({
        data: { input: "<body_profile>68kg</body_profile>", count: 3, ok: true, nothing: null },
      }),
    ).toEqual({ input: "<body_profile>[REDACTED]</body_profile>", count: 3, ok: true, nothing: null });
  });

  it("passes non-string, non-array, non-object payloads through unchanged", () => {
    expect(redactTracedPayload({ data: 42 })).toBe(42);
    expect(redactTracedPayload({ data: true })).toBe(true);
    expect(redactTracedPayload({ data: null })).toBe(null);
    expect(redactTracedPayload({ data: undefined })).toBe(undefined);
  });
});

describe("TRACE_REDACTION_RULES — the production rule set", () => {
  it("registers exactly one rule: <body_profile>", () => {
    expect(TRACE_REDACTION_RULES).toEqual([{ open: "<body_profile>", close: "</body_profile>" }]);
  });
});

describe("isRedactionVerified — the fail-closed backstop check", () => {
  it("is verified (true) when the inner text is empty — nothing to protect", () => {
    expect(isRedactionVerified("any rendered text at all", "")).toBe(true);
  });

  it("is verified when the inner text is properly delimited and therefore redacted", () => {
    const innerText = "USER BODY PROFILE (self-reported):\n- Bodyweight: 68 kg";
    const rendered = `…profile…\n\n<body_profile>\n${innerText}\n</body_profile>\n\nUser context…`;
    expect(isRedactionVerified(rendered, innerText)).toBe(true);
  });

  it("is NOT verified when the inner text survives redaction (delimiters lost)", () => {
    const innerText = "USER BODY PROFILE (self-reported):\n- Bodyweight: 68 kg";
    // Simulates a broken renderer that emitted the section's text WITHOUT the
    // <body_profile> wrapper — redactSpans has nothing to match.
    const rendered = `…profile…\n\n${innerText}\n\nUser context…`;
    expect(isRedactionVerified(rendered, innerText)).toBe(false);
  });

  it("does not false-positive on a bare numeral unrelated to the body profile", () => {
    // The check is on the distinctive multi-line inner text, never on a bare
    // numeral — a prompt line like "Session duration: 68 minutes" must never
    // trip the backstop just because it shares a digit with a bodyweight.
    const rendered = "Session duration: 68 minutes";
    const innerText = "USER BODY PROFILE (self-reported):\n- Bodyweight: 68 kg";
    expect(isRedactionVerified(rendered, innerText)).toBe(true);
  });
});
