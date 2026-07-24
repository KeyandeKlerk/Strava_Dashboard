export const KG_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
export const LB_PLATES = [45, 35, 25, 10, 5, 2.5];
export const DEFAULT_BAR_KG = 20;
export const DEFAULT_BAR_LB = 45;

export function calculatePlates(
  targetWeight: number,
  barWeight: number,
  unit: "kg" | "lb",
): { platesPerSide: number[]; remainder: number } {
  const plates = unit === "lb" ? LB_PLATES : KG_PLATES;
  let perSide = Math.max(0, (targetWeight - barWeight) / 2);
  const result: number[] = [];
  for (const plate of plates) {
    while (perSide + 1e-9 >= plate) {
      result.push(plate);
      perSide -= plate;
    }
  }
  return { platesPerSide: result, remainder: Math.max(0, perSide) };
}
