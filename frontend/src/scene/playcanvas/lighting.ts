import { Color, Entity, type Application } from "playcanvas";

/** Splats and baked unlit room materials retain their own illumination. */
export function createFurnitureLighting(app: Application, importedInterior = false): () => void {
  app.scene.ambientLight = importedInterior ? new Color(0.48, 0.47, 0.44) : new Color(0.68, 0.65, 0.60);
  app.scene.exposure = 1;
  const lights = new Entity("Furniture illumination");
  const key = new Entity("Soft window light");
  key.addComponent("light", { type: "directional", color: new Color(1, 0.94, 0.85), intensity: 1.15, castShadows: false });
  key.setEulerAngles(48, -38, 0);
  lights.addChild(key);
  const fill = new Entity("Cool room fill");
  fill.addComponent("light", { type: "directional", color: new Color(0.78, 0.87, 1), intensity: 0.45, castShadows: false });
  fill.setEulerAngles(28, 145, 0);
  lights.addChild(fill);
  if (importedInterior) {
    // Static architectural bounce light is baked into the room's unlit atlas.
    // Keep gentle lighting for editable furniture and remaining fixture materials.
    // The former wide ceiling spotlight produced low-resolution shadow banding;
    // it cannot add contact shadows to an unlit baked floor in any case.
    key.light!.intensity = 0.45;
    fill.light!.intensity = 0.25;
  }
  app.root.addChild(lights);
  return () => lights.destroy();
}
