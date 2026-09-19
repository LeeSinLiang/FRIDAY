export function validateScale(value: unknown): number {
  const scale =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error("SCENE_UNIT_CM must be a finite positive number");
  return scale;
}
export const SCENE_UNIT_CM = validateScale(
  import.meta.env.VITE_SCENE_UNIT_CM ?? 5,
);
export const cmToScene = (cm: number, scale = SCENE_UNIT_CM) =>
  cm / validateScale(scale);
export const sceneToCm = (units: number, scale = SCENE_UNIT_CM) =>
  units * validateScale(scale);
export const meterGlbToSceneScale = (scale = SCENE_UNIT_CM) =>
  100 / validateScale(scale);
