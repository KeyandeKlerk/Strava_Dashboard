import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getUnit, resetWeightUnitStoreForTests, setUnit, subscribe } from "./weightUnitStore";

function fakeWindow() {
  const store = new Map<string, string>();
  return {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
  } as unknown as Window & typeof globalThis;
}

describe("weightUnitStore", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = fakeWindow();
    resetWeightUnitStoreForTests();
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("defaults to kg when nothing is stored", () => {
    expect(getUnit()).toBe("kg");
  });

  it("persists the unit across getUnit() calls", () => {
    setUnit("lb");
    expect(getUnit()).toBe("lb");
  });

  it("notifies every subscriber when the unit changes, so all mounted instances can re-render in sync", () => {
    const calls: string[] = [];
    const unsubA = subscribe(() => calls.push("A"));
    const unsubB = subscribe(() => calls.push("B"));

    setUnit("lb");

    expect(calls).toEqual(["A", "B"]);
    unsubA();
    unsubB();
  });

  it("stops notifying a subscriber after it unsubscribes", () => {
    const calls: string[] = [];
    const unsub = subscribe(() => calls.push("A"));
    unsub();

    setUnit("lb");

    expect(calls).toEqual([]);
  });
});
