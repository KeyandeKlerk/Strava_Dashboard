import { describe, expect, it } from "vitest";
import { REST_TIMER_PRESETS_SECONDS, nextRestTimerPreset } from "./gymRestTimer";

describe("nextRestTimerPreset", () => {
  it("cycles through all 4 presets and wraps back to the first", () => {
    expect(REST_TIMER_PRESETS_SECONDS).toEqual([60, 90, 120, 180]);
    expect(nextRestTimerPreset(60)).toBe(90);
    expect(nextRestTimerPreset(90)).toBe(120);
    expect(nextRestTimerPreset(120)).toBe(180);
    expect(nextRestTimerPreset(180)).toBe(60);
  });

  it("resets to the first preset for an unknown/stale value", () => {
    expect(nextRestTimerPreset(45)).toBe(60);
    expect(nextRestTimerPreset(0)).toBe(60);
    expect(nextRestTimerPreset(-1)).toBe(60);
  });
});
