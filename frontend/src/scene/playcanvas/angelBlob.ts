import * as pc from "playcanvas";
import { cmToScene } from "../units";

/** Floor-pivoted, 38 cm marshmallow helper. Its face and pushing direction are +Z. */
export function createAngelBlob() {
  const entity = new pc.Entity("Little halo helper");
  const bounce = new pc.Entity("Happy bounce");
  const bodyRig = new pc.Entity("Marshmallow wobble");
  entity.addChild(bounce);
  bounce.addChild(bodyRig);

  const material = (name: string, color: string, gloss: number) => {
    const surface = new pc.StandardMaterial();
    surface.name = name;
    surface.diffuse = new pc.Color().fromString(color);
    surface.gloss = gloss;
    surface.update();
    return surface;
  };
  const white = material("Warm marshmallow", "#fffaf2", 0.24);
  const ink = material("Little dot face", "#302a29", 0.12);
  const pink = material("Peach cheeks", "#f4b6ad", 0.12);
  const gold = material("Honey halo", "#ffd879", 0.48);
  gold.emissive = new pc.Color(0.22, 0.13, 0.025);
  gold.update();

  const position = (part: pc.Entity, x: number, y: number, z: number) =>
    part.setLocalPosition(cmToScene(x), cmToScene(y), cmToScene(z));
  const scale = (part: pc.Entity, x: number, y: number, z: number) =>
    part.setLocalScale(cmToScene(x), cmToScene(y), cmToScene(z));
  const sphere = (name: string, parent: pc.Entity, size: [number, number, number],
    at: [number, number, number], surface = white) => {
    const part = new pc.Entity(name);
    part.addComponent("render", {
      type: "sphere", material: surface, castShadows: false, receiveShadows: true,
    });
    scale(part, ...size);
    position(part, ...at);
    parent.addChild(part);
    return part;
  };

  sphere("Squishy body", bodyRig, [30, 29, 25], [0, 18, 0]);
  for (const side of [-1, 1]) {
    sphere("Button eye", bodyRig, [2.1, 2.7, 1.1], [side * 5, 21, 12], ink);
    sphere("Rosy cheek", bodyRig, [4.2, 2.1, 0.9], [side * 8.5, 17.6, 10.7], pink);
  }
  sphere("Tiny mouth", bodyRig, [1.6, 1.2, 0.7], [0, 17.5, 12.5], ink);
  const feet = [-1, 1].map(side =>
    sphere("Little foot", bounce, [8, 5.6, 11], [side * 7, 2.8, 3]));
  const hands = [-1, 1].map(side =>
    sphere("Nub hand", bodyRig, [6, 9, 6], [side * 14.7, 15, 1.5]));

  // The primitive cache supplies the spheres; only this thin ring owns a custom mesh.
  const haloMesh = pc.createTorus(pc.AppBase.getApplication()!.graphicsDevice, {
    ringRadius: cmToScene(8), tubeRadius: cmToScene(0.75), segments: 32, sides: 8,
  });
  const halo = new pc.Entity("Floating golden halo");
  halo.addComponent("render", {
    meshInstances: [new pc.MeshInstance(haloMesh, gold)],
    castShadows: false, receiveShadows: false,
  });
  position(halo, 0, 37, 0);
  halo.setLocalEulerAngles(0, 0, -8);
  bounce.addChild(halo);

  let disposed = false;
  return {
    entity,
    /** Celebration is a 0..1 arrival pulse; the caller owns world movement and heading. */
    animate(timeSeconds: number, walking: boolean, pushing: boolean, celebration = 0) {
      const stride = Math.sin(timeSeconds * (pushing ? 15 : 11));
      const step = walking ? stride : 0;
      const hop = Math.max(0, Math.min(1, celebration));
      position(bounce, 0, Math.sin(hop * Math.PI) * 8, 0);
      position(bodyRig, 0, walking ? Math.abs(step) * 1.1 : Math.sin(timeSeconds * 2.5) * 0.25, 0);
      bodyRig.setLocalEulerAngles(pushing ? 10 : 0, 0, step * (pushing ? 2 : 5));
      bodyRig.setLocalScale(1 + Math.abs(step) * 0.018, 1 - Math.abs(step) * 0.025, 1);
      feet.forEach((foot, index) => {
        const side = index === 0 ? -1 : 1;
        const phase = step * side;
        position(foot, side * 7, 2.8 + Math.max(0, phase) * 3, 3 + phase * 3);
        foot.setLocalEulerAngles(phase * 12, 0, side * hop * 12);
      });
      hands.forEach((hand, index) => {
        const side = index === 0 ? -1 : 1;
        position(hand, side * (pushing ? 11.5 : 14.7), pushing ? 17 : 15 + hop * 8,
          pushing ? 12.5 : 1.5 - step * side * 3);
        scale(hand, 6, pushing ? 6 : 9, pushing ? 10 : 6);
        hand.setLocalEulerAngles(pushing ? -15 : step * side * 20, 0, side * hop * 45);
      });
      position(halo, 0, 37 + Math.sin(timeSeconds * 3) * 0.7, 0);
      halo.setLocalEulerAngles(0, 0, -8 + step * 3);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      entity.destroy();
      haloMesh.destroy();
      for (const surface of [white, ink, pink, gold]) surface.destroy();
    },
  };
}
