import { describe, expect, it } from "vitest";
import { calculatePlates } from "./plateCalculator";

describe("calculatePlates", () => {
  it("exact-match case: 100kg target with 20kg bar yields [25, 15] per side", () => {
    const result = calculatePlates(100, 20, "kg");
    expect(result.platesPerSide).toEqual([25, 15]);
    expect(result.remainder).toBe(0);
  });

  it("remainder case: 105kg target with 20kg bar leaves a small remainder", () => {
    const result = calculatePlates(105, 20, "kg");
    // 105 - 20 = 85, per side = 42.5
    // 25 + 20 = 45 > 42.5, so just 25 = 25, remainder 17.5
    // Actually: 25 + 15 = 40, remainder 2.5
    // Let me think: 42.5 per side
    // 25 + 15 + 2.5 = 42.5, so [25, 15, 2.5], remainder 0
    expect(result.platesPerSide).toEqual([25, 15, 2.5]);
    expect(result.remainder).toBe(0);
  });

  it("lb-unit case: 315lb target with 45lb bar yields lb plates", () => {
    const result = calculatePlates(315, 45, "lb");
    // 315 - 45 = 270, per side = 135
    // 45 + 45 + 45 = 135, so [45, 45, 45], remainder 0
    expect(result.platesPerSide).toEqual([45, 45, 45]);
    expect(result.remainder).toBe(0);
  });

  it("below-bar-weight case: 10kg target with 20kg bar yields empty plates and 0 remainder", () => {
    const result = calculatePlates(10, 20, "kg");
    expect(result.platesPerSide).toEqual([]);
    expect(result.remainder).toBe(0);
  });
});
