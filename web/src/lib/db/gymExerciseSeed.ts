// Curated starter exercise library, seeded via SCHEMA_STATEMENTS (see schema.ts)
// so a fresh local/test DB is fully usable, and via scripts/add-gym-tables.ts
// against production MotherDuck.
export const MUSCLE_GROUPS = [
  "Chest",
  "Lats",
  "Upper Back",
  "Traps",
  "Quads",
  "Hamstrings",
  "Glutes",
  "Calves",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Core",
  "Forearms",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export interface GymExerciseSeedRow {
  name: string;
  muscle_group: MuscleGroup;
  equipment?: string;
}

export const GYM_EXERCISE_SEED: readonly GymExerciseSeedRow[] = [
  // Chest
  { name: "Barbell Bench Press", muscle_group: "Chest", equipment: "barbell" },
  { name: "Incline Barbell Bench Press", muscle_group: "Chest", equipment: "barbell" },
  { name: "Dumbbell Bench Press", muscle_group: "Chest", equipment: "dumbbell" },
  { name: "Incline Dumbbell Press", muscle_group: "Chest", equipment: "dumbbell" },
  { name: "Machine Chest Press", muscle_group: "Chest", equipment: "machine" },
  { name: "Cable Fly", muscle_group: "Chest", equipment: "cable" },
  { name: "Push-Up", muscle_group: "Chest", equipment: "bodyweight" },
  { name: "Dip", muscle_group: "Chest", equipment: "bodyweight" },
  // Lats / Upper Back
  { name: "Pull-Up", muscle_group: "Lats", equipment: "bodyweight" },
  { name: "Chin-Up", muscle_group: "Lats", equipment: "bodyweight" },
  { name: "Lat Pulldown", muscle_group: "Lats", equipment: "cable" },
  { name: "Barbell Row", muscle_group: "Upper Back", equipment: "barbell" },
  { name: "Pendlay Row", muscle_group: "Upper Back", equipment: "barbell" },
  { name: "Dumbbell Row", muscle_group: "Upper Back", equipment: "dumbbell" },
  { name: "Seated Cable Row", muscle_group: "Upper Back", equipment: "cable" },
  { name: "T-Bar Row", muscle_group: "Upper Back", equipment: "barbell" },
  { name: "Face Pull", muscle_group: "Upper Back", equipment: "cable" },
  // Traps
  { name: "Barbell Shrug", muscle_group: "Traps", equipment: "barbell" },
  { name: "Dumbbell Shrug", muscle_group: "Traps", equipment: "dumbbell" },
  // Quads
  { name: "Barbell Back Squat", muscle_group: "Quads", equipment: "barbell" },
  { name: "Barbell Front Squat", muscle_group: "Quads", equipment: "barbell" },
  { name: "Leg Press", muscle_group: "Quads", equipment: "machine" },
  { name: "Walking Lunge", muscle_group: "Quads", equipment: "dumbbell" },
  { name: "Bulgarian Split Squat", muscle_group: "Quads", equipment: "dumbbell" },
  { name: "Leg Extension", muscle_group: "Quads", equipment: "machine" },
  { name: "Goblet Squat", muscle_group: "Quads", equipment: "dumbbell" },
  // Hamstrings
  { name: "Romanian Deadlift", muscle_group: "Hamstrings", equipment: "barbell" },
  { name: "Leg Curl", muscle_group: "Hamstrings", equipment: "machine" },
  { name: "Good Morning", muscle_group: "Hamstrings", equipment: "barbell" },
  // Glutes
  { name: "Hip Thrust", muscle_group: "Glutes", equipment: "barbell" },
  { name: "Cable Kickback", muscle_group: "Glutes", equipment: "cable" },
  { name: "Conventional Deadlift", muscle_group: "Glutes", equipment: "barbell" },
  // Calves
  { name: "Standing Calf Raise", muscle_group: "Calves", equipment: "machine" },
  { name: "Seated Calf Raise", muscle_group: "Calves", equipment: "machine" },
  // Shoulders
  { name: "Overhead Press", muscle_group: "Shoulders", equipment: "barbell" },
  { name: "Dumbbell Shoulder Press", muscle_group: "Shoulders", equipment: "dumbbell" },
  { name: "Lateral Raise", muscle_group: "Shoulders", equipment: "dumbbell" },
  { name: "Front Raise", muscle_group: "Shoulders", equipment: "dumbbell" },
  { name: "Rear Delt Fly", muscle_group: "Shoulders", equipment: "dumbbell" },
  { name: "Arnold Press", muscle_group: "Shoulders", equipment: "dumbbell" },
  // Biceps
  { name: "Barbell Curl", muscle_group: "Biceps", equipment: "barbell" },
  { name: "Dumbbell Curl", muscle_group: "Biceps", equipment: "dumbbell" },
  { name: "Hammer Curl", muscle_group: "Biceps", equipment: "dumbbell" },
  { name: "Preacher Curl", muscle_group: "Biceps", equipment: "barbell" },
  { name: "Cable Curl", muscle_group: "Biceps", equipment: "cable" },
  // Triceps
  { name: "Close-Grip Bench Press", muscle_group: "Triceps", equipment: "barbell" },
  { name: "Triceps Pushdown", muscle_group: "Triceps", equipment: "cable" },
  { name: "Overhead Triceps Extension", muscle_group: "Triceps", equipment: "dumbbell" },
  { name: "Skull Crusher", muscle_group: "Triceps", equipment: "barbell" },
  // Core
  { name: "Plank", muscle_group: "Core", equipment: "bodyweight" },
  { name: "Hanging Leg Raise", muscle_group: "Core", equipment: "bodyweight" },
  { name: "Cable Crunch", muscle_group: "Core", equipment: "cable" },
  { name: "Ab Wheel Rollout", muscle_group: "Core", equipment: "other" },
  // Forearms
  { name: "Farmer's Walk", muscle_group: "Forearms", equipment: "dumbbell" },
  { name: "Wrist Curl", muscle_group: "Forearms", equipment: "barbell" },
];

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

// tablePrefix is "" for local statements appended to SCHEMA_STATEMENTS, or
// "md." for the production migration script (scripts/add-gym-tables.ts).
export function buildGymExerciseSeedStatements(tablePrefix = ""): string[] {
  return GYM_EXERCISE_SEED.map((row) => {
    const equipment = row.equipment ? `'${escapeSqlLiteral(row.equipment)}'` : "NULL";
    return `INSERT INTO ${tablePrefix}gym_exercises (name, muscle_group, equipment, is_custom) VALUES ('${escapeSqlLiteral(
      row.name,
    )}', '${escapeSqlLiteral(row.muscle_group)}', ${equipment}, FALSE) ON CONFLICT (name) DO NOTHING`;
  });
}
