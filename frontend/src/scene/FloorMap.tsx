import { useLayoutEffect, useRef, useState } from "react";
import type { FirstPersonCamera, Room } from "./types";
import { buildingFloors } from "./buildingFloors";

type Props = {
  room: Room;
  getCamera: () => FirstPersonCamera | null;
  onFloorChange?: (roomId: string) => void;
  floorChangeDisabled?: boolean;
  /** The catalogue search panel is open. It owns this corner (fixed, z-index 30), so the map gives the corner up
   *  rather than hide under it: it collapses to the floor number and the up/down controls, above the panel. */
  compact?: boolean;
};

/** A navigation aid: the room moves around the fixed person marker. */
export default function FloorMap({ room, getCamera, onFloorChange, floorChangeDisabled, compact = false }: Props) {
  const floor = buildingFloors(room);
  const [expanded, setExpanded] = useState(false);
  const world = useRef<SVGGElement>(null);
  const north = useRef<SVGGElement>(null);
  const extent = Math.max(room.widthCm, room.depthCm) * 1.2;
  const center = extent / 2;
  const markerX = center + (room.scan?.defaultCamera.xCm ?? room.widthCm / 2) - room.widthCm / 2;
  const markerY = center + (room.scan?.defaultCamera.zCm ?? room.depthCm / 2) - room.depthCm / 2;

  useLayoutEffect(() => {
    let frame = 0;
    let lastX = NaN, lastZ = NaN, lastYaw = NaN;
    const update = () => {
      const camera = getCamera() ?? room.scan?.defaultCamera;
      if (camera && (!Number.isFinite(lastX) || Math.abs(camera.xCm - lastX) > 0.25 || Math.abs(camera.zCm - lastZ) > 0.25 || Math.abs(camera.yawRad - lastYaw) > 0.001)) {
        const yaw = camera.yawRad * 180 / Math.PI;
        world.current?.setAttribute("transform", `translate(${markerX} ${markerY}) rotate(${yaw}) translate(${-camera.xCm} ${-camera.zCm})`);
        north.current?.setAttribute("transform", `rotate(${yaw} 19 19)`);
        lastX = camera.xCm;
        lastZ = camera.zCm;
        lastYaw = camera.yawRad;
      }
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [getCamera, markerX, markerY, room]);

  return <aside className={`glass floor-map${compact ? " is-compact" : expanded ? " is-expanded" : ""}`} aria-label="Room map">
    <div className="floor-map-heading">
      <span className="floor-map-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></svg>
        <span>Floor {floor.number} / {floor.count}</span>
      </span>
      <button type="button" className="floor-map-expand" aria-label={expanded ? "Collapse map" : "Expand map"} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} title={expanded ? "Collapse map" : "Expand map"}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/></svg>
      </button>
    </div>
    <div className="floor-map-content">
      <div className="floor-map-viewport">
        <svg viewBox={`0 0 ${extent} ${extent}`} role="img" aria-label={`Floor ${floor.number} room outline aligned with your view and rotating around your position`}>
          <defs><pattern id="floor-map-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 H 0 V 50" fill="none" stroke="#aa9d8d" strokeOpacity=".2" strokeWidth="2"/></pattern></defs>
          <g ref={world}>
            <rect x="0" y="0" width={room.widthCm} height={room.depthCm} fill="#f8f6f1" stroke="#8d8070" strokeWidth="10"/>
            <rect x="0" y="0" width={room.widthCm} height={room.depthCm} fill="url(#floor-map-grid)"/>
          </g>
          <g transform={`translate(${markerX} ${markerY})`} aria-hidden="true">
            <circle r="31" fill="#fffaf3" stroke="#a8462a" strokeWidth="5"/>
            <path d="M 0 -23 17 18 0 9 -17 18Z" fill="#a8462a"/>
          </g>
        </svg>
      </div>
      <div className="floor-map-levels" aria-label="Building floor controls">
        <button type="button" aria-label="Floor up" title={floor.count === 1 ? "This room has only one floor" : "Go up one floor"} disabled={!floor.next || !onFloorChange || floorChangeDisabled} onClick={() => floor.next && onFloorChange?.(floor.next.roomId)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button>
        <span className="floor-map-level-count">{floor.number} / {floor.count}</span>
        <button type="button" aria-label="Floor down" title={floor.count === 1 ? "This room has only one floor" : "Go down one floor"} disabled={!floor.previous || !onFloorChange || floorChangeDisabled} onClick={() => floor.previous && onFloorChange?.(floor.previous.roomId)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg></button>
        <span className="floor-map-north" aria-label="North direction" title="North direction">
          <svg viewBox="0 0 38 38" aria-hidden="true">
            <circle cx="19" cy="19" r="16" fill="none" stroke="currentColor" strokeOpacity=".28" strokeWidth="1"/>
            <g ref={north}>
              <path d="M19 5 23 19 19 16 15 19Z" fill="#a8462a"/>
              <path d="M19 33 23 19 19 22 15 19Z" fill="#66594b"/>
            </g>
            <circle cx="19" cy="19" r="6" fill="#fffaf3"/>
            <text x="19" y="22" textAnchor="middle" fill="#352c24" fontSize="8" fontWeight="800">N</text>
          </svg>
        </span>
      </div>
    </div>
    {room.scan&&<p className="floor-map-credit"><a href={room.scan.attribution.url} target="_blank" rel="noreferrer">{room.scan.attribution.title} · {room.scan.attribution.author}</a><span> · </span><a href={room.scan.attribution.licenseUrl} target="_blank" rel="noreferrer">{room.scan.attribution.license}</a></p>}
  </aside>;
}
