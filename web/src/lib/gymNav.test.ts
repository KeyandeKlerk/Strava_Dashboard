import { describe, expect, it } from "vitest";
import { GYM_TABS, isGymTabActive } from "./gymNav";

describe("GYM_TABS", () => {
  it("lists Sessions, Plan, Insights, Weight in order", () => {
    expect(GYM_TABS.map((t) => t.label)).toEqual(["Sessions", "Plan", "Insights", "Weight"]);
    expect(GYM_TABS.map((t) => t.href)).toEqual(["/gym", "/gym/plan", "/gym/insights", "/gym/bodyweight"]);
  });
});

describe("isGymTabActive", () => {
  it("matches an exact path", () => {
    expect(isGymTabActive("/gym/plan", "/gym/plan")).toBe(true);
  });

  it("matches a nested path under the tab's href", () => {
    expect(isGymTabActive("/gym/plan/edit", "/gym/plan")).toBe(true);
  });

  it("does not match a sibling tab", () => {
    expect(isGymTabActive("/gym/insights", "/gym/plan")).toBe(false);
  });

  it("does not treat /gym as active for every nested route (exact-match only for the Sessions tab)", () => {
    expect(isGymTabActive("/gym/plan", "/gym")).toBe(false);
  });

  it("matches /gym itself for the Sessions tab", () => {
    expect(isGymTabActive("/gym", "/gym")).toBe(true);
  });
});
