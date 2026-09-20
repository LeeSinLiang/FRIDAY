import type { Instance, Product, Room } from './types';
import fixtures from '../../../shared/scene-fixtures.json';

type Preset = { label: string; room: Room; instances: Instance[] };
const PRESETS = fixtures.rooms as Record<string, Preset>;

// ?room=studio picks a room preset for this page load. It is a module constant on purpose: the editor,
// the sync layer and the solver all assume one room for the life of the page, so switching reloads.
// The server learns the choice from a cookie, which moves every scene endpoint to that room's layout.
const requested = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('room');
export const ROOM_ID: string | null = requested && PRESETS[requested] ? requested : null;
export const ROOM_LABEL: string = ROOM_ID ? PRESETS[ROOM_ID].label : 'Living room';
export const ROOM: Room = ROOM_ID ? PRESETS[ROOM_ID].room : fixtures.room;
export const ROOM_CHOICES: { id: string | null; label: string }[] =
  [{ id: null, label: 'Living room' }, ...Object.entries(PRESETS).map(([id, preset]) => ({ id, label: preset.label }))];
export const PRODUCTS: Product[] = fixtures.products as Product[];

if (typeof document !== 'undefined') document.cookie = `friday_room=${ROOM_ID ?? ''}; path=/; SameSite=Lax`;
