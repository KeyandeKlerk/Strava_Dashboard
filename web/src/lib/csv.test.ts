import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a simple header + rows", () => {
    const text = "date,description\n2026-07-01,Easy run\n2026-07-02,Long run";
    expect(parseCsv(text)).toEqual([
      { date: "2026-07-01", description: "Easy run" },
      { date: "2026-07-02", description: "Long run" },
    ]);
  });

  it("handles a properly quoted field with an embedded comma", () => {
    const text = 'date,description\n2026-07-01,"Easy run, 10km"';
    expect(parseCsv(text)).toEqual([{ date: "2026-07-01", description: "Easy run, 10km" }]);
  });

  it("handles an escaped double-quote inside a quoted field", () => {
    const text = 'date,description\n2026-07-01,"Say ""hi"" run"';
    expect(parseCsv(text)).toEqual([{ date: "2026-07-01", description: 'Say "hi" run' }]);
  });

  it("handles a quoted field spanning an embedded newline", () => {
    const text = 'date,description\n2026-07-01,"Line one\nLine two"';
    expect(parseCsv(text)).toEqual([{ date: "2026-07-01", description: "Line one\nLine two" }]);
  });

  it("treats a stray quote mid-field as a literal character, not a quote-open", () => {
    const text = 'date,description\n2026-07-01,Add a 6" step here\n2026-07-02,Easy recovery run\n2026-07-03,Long run 20km';
    expect(parseCsv(text)).toEqual([
      { date: "2026-07-01", description: 'Add a 6" step here' },
      { date: "2026-07-02", description: "Easy recovery run" },
      { date: "2026-07-03", description: "Long run 20km" },
    ]);
  });
});
