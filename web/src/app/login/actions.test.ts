import { describe, expect, it } from "vitest";
import { sanitizeRedirectTarget } from "./actions";

describe("sanitizeRedirectTarget", () => {
  it("allows a same-origin relative path", () => {
    expect(sanitizeRedirectTarget("/gym/plan")).toBe("/gym/plan");
  });

  it("falls back to / for an absolute URL to another origin", () => {
    expect(sanitizeRedirectTarget("https://evil.example.com")).toBe("/");
  });

  it("falls back to / for a protocol-relative URL", () => {
    expect(sanitizeRedirectTarget("//evil.example.com")).toBe("/");
  });

  it("falls back to / for a scheme with no slashes", () => {
    expect(sanitizeRedirectTarget("javascript:alert(1)")).toBe("/");
  });

  it("falls back to / for an empty string", () => {
    expect(sanitizeRedirectTarget("")).toBe("/");
  });
});
