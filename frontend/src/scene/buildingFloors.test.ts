import assert from "node:assert/strict";
import test from "node:test";
import { Entity } from "playcanvas";
import { initialRoom, buildingFloors, roomVisualKey, galleryRoomId } from "./buildingFloors";
import { switchBuildingFloor } from "./playcanvas/buildingFloor";
import type { PlayCanvasRuntime } from "./playcanvas/runtime";
import type { Room, Product } from "./types";
import { validatePlacement } from "./placement";
import { cmToScene } from "./units";
import lower from "../../../shared/rooms/london-skyscraper/manifest.json";
import upper from "../../../shared/rooms/london-skyscraper-level-c32/manifest.json";
import obstructed from "../../../shared/rooms/london-skyscraper-c20/manifest.json";
import spatial from "../../../shared/rooms/london-skyscraper-c20/spatial.json";
import lobbySpatial from "../../../shared/rooms/london-skyscraper/spatial.json";
import empty from "../../../shared/rooms/empty-room/manifest.json";

const first = lower.room as unknown as Room, last = upper.room as unknown as Room;
test("floor navigation is bounded and leaves ordinary room selection unchanged", () => {
  assert.equal(initialRoom("empty-room", "C32"), "empty-room");
  assert.equal(galleryRoomId("empty-room"), "empty-room");
  assert.equal(galleryRoomId(last.roomId), first.roomId);
  assert.equal(galleryRoomId("london-skyscraper-c99"), "london-skyscraper-c99");
  assert.equal(initialRoom(last.roomId, null), last.roomId);
  assert.equal(initialRoom(first.roomId, "C32"), last.roomId);
  assert.equal(initialRoom(first.roomId, "C99"), first.roomId);
  assert.equal(initialRoom("../../private", "C32"), "haussmann-apartment");
  assert.deepEqual(buildingFloors(empty.room as unknown as Room), {number:1,count:1,previous:undefined,next:undefined});
  assert.equal(buildingFloors(first).previous, undefined);
  assert.equal(buildingFloors(first).next?.floorId, "M00");
  assert.equal(buildingFloors(last).number, 34);
  assert.equal(buildingFloors(last).next, undefined);
});

test("floor changes reuse the same model and preserve transforms without altering camera navigation", () => {
  const model = new Entity("building"), root = new Entity("room"), camera = new Entity("camera");
  root.addChild(model);
  const runtime = {room:first,roomRoot:root,camera,app:{renderNextFrame:false},capturing:false,disposed:false} as PlayCanvasRuntime;
  assert.equal(roomVisualKey(first),roomVisualKey(last));
  switchBuildingFloor(runtime,last);
  assert.equal(root.children[0],model);
  assert.equal(runtime.room,last);
  assert.ok(Math.abs(model.getLocalPosition().y + cmToScene(last.scan!.building!.elevationM * 100)) < .0002);
  assert.ok(Math.abs(camera.getPosition().y-cmToScene(last.scan!.defaultCamera.yCm))<.0001);
  runtime.capturing=true;
  assert.throws(()=>switchBuildingFloor(runtime,first));
  assert.equal(runtime.room,last);
  runtime.capturing=false;
  assert.throws(()=>switchBuildingFloor(runtime,empty.room as unknown as Room));
  const changed=structuredClone(first);changed.scan!.building!.sourceSha256="different";
  assert.throws(()=>switchBuildingFloor(runtime,changed));
  switchBuildingFloor(runtime,first);
  assert.equal(root.children[0],model);
});

test("off-centre upper-floor wall rejects its footprint but accepts the adjacent clear patch", () => {
  const room={...obstructed.room,spatial} as unknown as Room;
  const product:Product={productId:"small",name:"Small reference",widthCm:20,depthCm:20,heightCm:100,kind:"table",color:"#888"};
  const instance={instanceId:"small",productId:product.productId,pose:{xCm:330,zCm:700,yawRad:0}};
  assert.equal(validatePlacement(room,[product],[instance],instance.instanceId,instance.pose).code,"fixed_obstacle");
  assert.equal(validatePlacement(room,[product],[instance],instance.instanceId,{...instance.pose,xCm:280}).valid,true);
  assert.equal(validatePlacement(room,[product],[instance],instance.instanceId,{...instance.pose,zCm:300}).valid,true);
});

test("the lobby outline and asymmetric slanted edge match the real building", () => {
  // Compared to the actual entrance mesh and browser floor-plan in issue #89.
  assert.equal(first.scan!.building!.floorId, "G00");
  assert.ok(first.scan!.building!.elevationM < -4);
  assert.ok(first.scan!.floorOutlineCm![0].outer.length > 4);
  const room = { ...first, spatial: lobbySpatial } as Room;
  const product: Product = { productId:"edge-chair", name:"Boundary chair", widthCm:70, depthCm:75, heightCm:75, kind:"chair", color:"#888" };
  const instance = { instanceId:"edge-chair", productId:product.productId, pose:{xCm:1670,zCm:500,yawRad:0} };
  assert.equal(validatePlacement(room,[product],[instance],instance.instanceId,instance.pose).valid,true);
  assert.equal(validatePlacement(room,[product],[instance],instance.instanceId,{...instance.pose,xCm:1870}).code,"unknown_area");
});

test("previous saved floor routes retain their own coordinate contexts", () => {
  assert.equal(initialRoom("london-skyscraper-test", "C20"), "london-skyscraper-c20");
  for (const id of ["london-skyscraper-test", "london-skyscraper-c20"]) {
    assert.equal(galleryRoomId(id), first.roomId);
    assert.equal(initialRoom(id, null), id);
  }
});
