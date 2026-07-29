"use client";
// Display-only preference — storage always stays in kg (see weightUnit.ts).
import { useCallback, useSyncExternalStore } from "react";
import { kgToLb, lbToKg } from "@/lib/weightUnit";
import { getUnit, setUnit as setSharedUnit, subscribe, type WeightUnit } from "./weightUnitStore";

export type { WeightUnit };

function getServerSnapshot(): WeightUnit {
  return "kg";
}

export function useWeightUnit(): {
  unit: WeightUnit;
  setUnit(unit: WeightUnit): void;
  toDisplay(weightKg: number): number;
  toKg(displayWeight: number): number;
} {
  const unit = useSyncExternalStore(subscribe, getUnit, getServerSnapshot);

  const setUnit = useCallback((next: WeightUnit) => setSharedUnit(next), []);
  const toDisplay = useCallback((weightKg: number) => (unit === "lb" ? kgToLb(weightKg) : weightKg), [unit]);
  const toKg = useCallback((displayWeight: number) => (unit === "lb" ? lbToKg(displayWeight) : displayWeight), [unit]);

  return { unit, setUnit, toDisplay, toKg };
}
