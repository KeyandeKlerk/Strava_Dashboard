// Ported from category_map.yaml + src/category.py.
export const CATEGORY_MAP = {
  sport_type_map: {
    Run: "running",
    TrailRun: "running",
    VirtualRun: "running",
    WeightTraining: "gym",
    Workout: "other",
  } as Record<string, string>,
  name_keyword_overrides: {
    volleyball: "volleyball",
    cricket: "cricket",
    gym: "gym",
    strength: "gym",
    weights: "gym",
  } as Record<string, string>,
};

export function categorizeActivity(sportType: string, name: string): string {
  const category = CATEGORY_MAP.sport_type_map[sportType] ?? "other";

  if (category === "other") {
    const nameLower = name.toLowerCase();
    for (const [keyword, cat] of Object.entries(CATEGORY_MAP.name_keyword_overrides)) {
      if (nameLower.includes(keyword)) return cat;
    }
  }

  return category;
}
