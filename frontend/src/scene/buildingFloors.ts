import building from "../../../shared/skyscraper-test-scene.json";
import type { Room } from "./types";

/** A saved cart's floor ID belongs to the building's single public gallery entry. */
export function galleryRoomId(roomId: string) {
  return building.floors.some(floor => floor.roomId === roomId) || building.legacyRoomIds.includes(roomId)
    ? building.buildingId : roomId;
}

/** Explicit prepared contexts only: a URL cannot manufacture a new floor. */
export function initialRoom(requested: string | null | undefined, floor: string | null) {
  const level = building.floors.find(item => item.roomId === requested);
  if (level) return building.floors.find(item => item.floorId === floor)?.roomId ?? level.roomId;
  // Preserve existing saved scene/cart links in their original coordinate system.
  if (building.legacyRoomIds.includes(requested ?? ""))
    return building.legacyRoomIds.find((_id, index) => floor === `C${String(index + 1).padStart(2, "0")}`) ?? requested!;
  return ["haussmann-apartment", "studio-11", "empty-room", "cg-arch-interior", "cg-arch-lightmapper-proof"].includes(requested ?? "")
    ? requested! : "haussmann-apartment";
}

export function buildingFloors(room: Room) {
  const levels = room.scan?.building?.levels ?? [];
  const index = levels.findIndex(level => level.roomId === room.roomId);
  return index < 0
    ? { number: 1, count: 1, previous: undefined, next: undefined }
    : { number: index + 1, count: levels.length, previous: levels[index - 1], next: levels[index + 1] };
}

/** Only prepared floors of the same immutable GLB share a renderer. */
export function roomVisualKey(room: Room) {
  const scan = room.scan, building = scan?.building;
  return scan?.visualFormat === "glb" && building?.sourceSha256 && building.levels.some(level => level.roomId === room.roomId)
    ? `${building.buildingId}:${building.sourceSha256}:${scan.visualUrl}`
    : `${room.roomId}:${room.revision}:${scan?.geometryRevision}:${scan?.visualUrl}`;
}
