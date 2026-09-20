// Where each prepared room's doors and windows are. Pure data, measured from the room's own model.
//
// This lives beside the room rather than inside its manifest.json or spatial.json on purpose:
// scripts/import-room.sh refuses to install a room whose tracked metadata differs by a single byte
// from the bundle it was packed with, so adding a field there would break the import for everyone.

import cgArchInterior from "../../../shared/rooms/cg-arch-interior/openings.json";
import type { Opening } from "./types";

const OPENINGS_BY_ROOM: Record<string, Opening[]> = {
  [cgArchInterior.roomId]: cgArchInterior.openings as Opening[],
};

/** The room's openings, or undefined when nobody has measured them: the solver then says so rather than guessing. */
export const openingsFor = (roomId: string | undefined): Opening[] | undefined => (roomId ? OPENINGS_BY_ROOM[roomId] : undefined);
