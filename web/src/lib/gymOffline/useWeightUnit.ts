"use client";
// Display-only preference — storage always stays in kg (see weightUnit.ts).
import { useCallback, useState } from "react";
import { kgToLb, lbToKg } from "@/lib/weightUnit";

export type WeightUnit = "kg" | "lb";

const STORAGE_KEY = "gym-weight-unit";

function readStoredUnit(): WeightUnit {
  if (typeof window === "undefined") return "kg";
  return window.localStorage.getItem(STORAGE_KEY) === "lb" ? "lb" : "kg";
}

export function useWeightUnit(): {
  unit: WeightUnit;
  setUnit(unit: WeightUnit): void;
  toDisplay(weightKg: number): number;
  toKg(displayWeight: number): number;
} {
  const [unit, setUnitState] = useState<WeightUnit>(() => readStoredUnit());

  const setUnit = useCallback((next: WeightUnit) => {
    setUnitState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const toDisplay = useCallback((weightKg: number) => (unit === "lb" ? kgToLb(weightKg) : weightKg), [unit]);
  const toKg = useCallback((displayWeight: number) => (unit === "lb" ? lbToKg(displayWeight) : displayWeight), [unit]);

  return { unit, setUnit, toDisplay, toKg };
}
