import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Instance, Product, Room, SceneEdit } from "./types";
import type { AgentMotion } from "./playcanvas/angelMotion";
import { validInlineProduct } from "./products";

export type RoomSnapshot = { room: Room; products: Product[]; instances: Instance[]; revision: number; geometryRevision?: string; agentMotion?: AgentMotion };
export type RoomSessionState = {
  snapshot: RoomSnapshot | null;
  status: "loading" | "ready" | "saving" | "offline" | "conflict";
  message: string;
  canUndo: boolean;
  canRedo: boolean;
};
const fingerprint = (items: Instance[]) => JSON.stringify(items.map(item => ({
  instanceId: item.instanceId, productId: item.productId,
  ...(item.product ? { product: { productId: item.product.productId, name: item.product.name,
    widthCm: item.product.widthCm, depthCm: item.product.depthCm, heightCm: item.product.heightCm,
    color: item.product.color, kind: item.product.kind, modelUrl: item.product.modelUrl,
    thumbnailUrl: item.product.thumbnailUrl, catalogueVisible: item.product.catalogueVisible } } : {}),
  pose: { xCm: item.pose.xCm, zCm: item.pose.zCm, yawRad: item.pose.yawRad },
})));
export function parseRoomSnapshot(value: unknown, roomId: string): RoomSnapshot {
  if (!value || typeof value !== "object") throw Error("The server returned an invalid room.");
  const s = value as RoomSnapshot;
  if (!s.room || s.room.roomId !== roomId || ![s.room.widthCm,s.room.depthCm,s.room.heightCm].every(n => Number.isFinite(n) && n > 0) ||
      !Number.isSafeInteger(s.room.revision) || s.room.revision < 0 || !Number.isSafeInteger(s.revision) || s.revision < 0 ||
      !Array.isArray(s.products) || s.products.length > 1000 || !Array.isArray(s.instances) || s.instances.length > 100)
    throw Error("The saved room is incompatible with this editor.");
  const productIds = new Set<string>();
  for (const p of s.products) {
    if (!p || typeof p.productId !== "string" || !p.productId || productIds.has(p.productId) ||
        typeof p.name !== "string" || typeof p.color !== "string" || !["sofa", "table", "chair"].includes(p.kind) ||
        ![p.widthCm,p.depthCm,p.heightCm].every(n => Number.isFinite(n) && n > 0) ||
        (p.modelUrl !== undefined && typeof p.modelUrl !== "string") ||
        (p.thumbnailUrl !== undefined && typeof p.thumbnailUrl !== "string") ||
        (p.catalogueVisible !== undefined && typeof p.catalogueVisible !== "boolean")) throw Error("Invalid product dimensions or identity.");
    productIds.add(p.productId);
  }
  if (s.room.scan) {
    const scan = s.room.scan, spatial = s.room.spatial, camera = scan.defaultCamera;
    if (typeof scan.geometryRevision !== "string" || !scan.geometryRevision || s.geometryRevision !== scan.geometryRevision ||
        !scan.calibration || !["synthetic_demo", "confirmed", "unconfirmed"].includes(scan.calibration.status) ||
        typeof scan.calibration.note !== "string" || typeof scan.visualUrl !== "string" || !scan.visualUrl ||
        (scan.visualFormat !== undefined && !["splat", "glb"].includes(scan.visualFormat)) ||
        !Number.isFinite(scan.scale) || scan.scale <= 0 ||
        ![scan.positionCm, scan.rotationDeg].every(vector => Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite)) ||
        !camera || camera.kind !== "firstPerson" || ![camera.xCm, camera.yCm, camera.zCm, camera.yawRad, camera.pitchRad, camera.fovDeg].every(Number.isFinite) ||
        !scan.attribution || ![scan.attribution.title, scan.attribution.author, scan.attribution.url, scan.attribution.license, scan.attribution.licenseUrl].every(field => typeof field === "string") ||
        !spatial || !Array.isArray(spatial.freeAreas) || spatial.freeAreas.length > 256 || !Array.isArray(spatial.obstacles) || spatial.obstacles.length > 512)
      throw Error("The fixed room geometry is incomplete or mismatched.");
    if (!spatial.freeAreas.every(area => area && [area.minXcm, area.maxXcm, area.minZcm, area.maxZcm].every(Number.isFinite) &&
          0 <= area.minXcm && area.minXcm < area.maxXcm && area.maxXcm <= s.room.widthCm &&
          0 <= area.minZcm && area.minZcm < area.maxZcm && area.maxZcm <= s.room.depthCm)) throw Error("Invalid reviewed floor geometry.");
    const obstacles = new Set<string>();
    for (const obstacle of spatial.obstacles) {
      if (!obstacle || typeof obstacle.obstacleId !== "string" || !obstacle.obstacleId || obstacles.has(obstacle.obstacleId) ||
          typeof obstacle.label !== "string" || ![obstacle.xCm, obstacle.zCm, obstacle.yawRad, obstacle.widthCm, obstacle.depthCm].every(Number.isFinite) ||
          obstacle.widthCm <= 0 || obstacle.depthCm <= 0) throw Error("Invalid fixed obstacle geometry.");
      obstacles.add(obstacle.obstacleId);
    }
  }
  const ids = new Set<string>();
  for (const item of s.instances) {
    if (!item || typeof item.instanceId !== "string" || !item.instanceId.trim() || item.instanceId.length > 128 || ids.has(item.instanceId) || !productIds.has(item.productId) ||
        (item.product !== undefined && !validInlineProduct(item.product, item.productId)) ||
        !item.pose || ![item.pose.xCm,item.pose.zCm,item.pose.yawRad].every(Number.isFinite)) throw Error("The saved layout contains an invalid object.");
    ids.add(item.instanceId);
  }
  const motion = s.agentMotion;
  const validPose = (pose: unknown): pose is Instance["pose"] => !!pose && typeof pose === "object" &&
    ["xCm", "zCm", "yawRad"].every(key => Number.isFinite((pose as Record<string, unknown>)[key]));
  const agentMotion = motion && motion.revision === s.revision && ids.has(motion.instanceId) &&
    validPose(motion.toPose) && (motion.fromPose === null || validPose(motion.fromPose)) ? motion : undefined;
  // Keep catalogue metadata for history/restore, but the API product list is authoritative.
  const instances = s.instances.map(item => ({ ...item,
    ...(item.product === undefined ? {} : { product: s.products.find(product => product.productId === item.productId)! }),
  }));
  return structuredClone({room:s.room,products:s.products,instances,revision:s.revision,
    ...(s.geometryRevision === undefined ? {} : {geometryRevision:s.geometryRevision}),
    ...(agentMotion ? {agentMotion} : {})});
}

type Transport = { fetch?: typeof fetch; csrf?: () => string; id?: () => string };
type Pending = { body: {baseRevision: number; commandId: string; commands: SceneEdit[]}; before: Instance[]; kind: "edit" | "undo" | "redo" };

/** Server acceptance is the only commit point, including undo and retry after a lost response. */
export function createRoomSession(roomId: string, transport: Transport = {}) {
  let state: RoomSessionState = { snapshot: null, status: "loading", message: "Opening saved layout…", canUndo: false, canRedo: false };
  let past: Instance[][] = [], future: Instance[][] = [];
  let disposed = false, inFlight = false, active = false;
  let pending: Pending | null = null;
  let loading: Promise<void> | null = null;
  let abort: AbortController | undefined;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<RoomSessionState>) => {
    if (disposed) return;
    state = { ...state, ...patch, canUndo: past.length > 0, canRedo: future.length > 0 };
    listeners.forEach(fn => fn());
  };
  const csrf = () => transport.csrf?.() ?? decodeURIComponent(document.cookie.split(";").map(s=>s.trim()).find(s=>s.startsWith("csrftoken="))?.slice(10) ?? "");
  async function request(path: string, body?: unknown) {
    const controller = new AbortController();
    abort = controller;
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const token = body ? csrf() : "";
      if (body && !token) throw Error("Reload the room to restore its security token.");
      const response = await (transport.fetch ?? fetch)(`${path}?roomId=${encodeURIComponent(roomId)}`, {
        method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { Accept: "application/json", ...(body ? {"Content-Type":"application/json","X-CSRFToken":token} : {}) },
        ...(body ? {body: JSON.stringify(body)} : {}),
      });
      const json = await response.json();
      return { response, json };
    } finally { clearTimeout(timer); }
  }
  async function performLoad(force: boolean, reconcile: boolean) {
    inFlight = true;
    if (!state.snapshot) publish({status:"loading"});
    try {
      const {response,json} = await request("/api/scene/");
      if (!response.ok) throw Error(json.error?.message ?? "Cannot load this room.");
      if (disposed) return;
      const snapshot = parseRoomSnapshot(json,roomId);
      const changed = state.snapshot && (snapshot.revision !== state.snapshot.revision || snapshot.geometryRevision !== state.snapshot.geometryRevision);
      if (changed && active && !force) { publish({status:"conflict",message:"The room changed during your edit. Reload the saved layout."}); return; }
      if (active && !force) {
        // Explicit recovery can restore connectivity without replacing the
        // snapshot that an active placement preview was created against.
        if (reconcile) publish({status:"ready",message:"All changes saved"});
        return;
      }
      if (changed || force) { past=[]; future=[]; }
      publish({snapshot,status:"ready",message:changed ? "Updated from saved layout" : "All changes saved"});
    } catch (error) {
      if (!disposed) publish({status:"offline",message:error instanceof Error ? error.message : "Cannot reach the room service."});
    } finally { inFlight=false; }
  }
  function load(force = false, reconcile = false): Promise<void> {
    if (disposed || inFlight || pending || (!force && !reconcile && (active || state.status === "conflict"))) return Promise.resolve();
    loading = performLoad(force,reconcile).finally(() => { loading = null; });
    return loading;
  }
  async function sendPending(): Promise<boolean> {
    if (!pending || disposed || inFlight) return false;
    const sent = pending;
    inFlight=true;
    publish({status:"saving",message:"Saving layout…"});
    try {
      const {response,json} = await request("/api/scene/commands/",sent.body);
      if (disposed) return false;
      if (!response.ok) {
        // A definite rejection can be reconciled; an uncertain transport failure retains the same request ID.
        if (response.status < 500) pending=null;
        publish({status:response.status===409 ? "conflict" : response.status>=500 ? "offline" : "ready",message:json.error?.message ?? "Placement was rejected. Layout unchanged."});
        return false;
      }
      const snapshot=parseRoomSnapshot(json,roomId);
      if (fingerprint(snapshot.instances)!==fingerprint(sent.before)) {
        if (sent.kind==="edit") { past=[...past,sent.before].slice(-100); future=[]; }
        else if (sent.kind==="undo") { past=past.slice(0,-1); future=[sent.before,...future]; }
        else { past=[...past,sent.before].slice(-100); future=future.slice(1); }
      }
      pending=null;
      publish({snapshot,status:"ready",message:"All changes saved"});
      return true;
    } catch (error) {
      if (!disposed) publish({status:"offline",message:"Connection interrupted. Retry to confirm the saved result."});
      return false;
    } finally { inFlight=false; }
  }
  async function submit(commands: SceneEdit[], kind: Pending["kind"] = "edit") {
    if (disposed || pending || !state.snapshot || state.status!=="ready") return false;
    const proposedRevision = state.snapshot.revision;
    const proposedGeometry = state.snapshot.geometryRevision;
    // A harmless background poll must not swallow a click. Finish it first and
    // refuse the proposal if it discovered a newer layout during that interval.
    if (loading) await loading;
    if (disposed || inFlight || pending || state.status!=="ready") return false;
    if (state.snapshot.revision !== proposedRevision || state.snapshot.geometryRevision !== proposedGeometry) {
      publish({status:"conflict",message:"The saved layout changed. Review the updated room before trying again."});
      return false;
    }
    pending={body:{baseRevision:state.snapshot.revision,commandId:transport.id?.() ?? crypto.randomUUID(),commands:structuredClone(commands)},before:structuredClone(state.snapshot.instances),kind};
    return sendPending();
  }
  const restore = (kind: "undo"|"redo") => {
    const target = kind==="undo" ? past.at(-1) : future[0];
    if (!target || !state.snapshot) return Promise.resolve(false);
    const commands: SceneEdit[] = [...state.snapshot.instances.map(i=>({type:"remove" as const,instanceId:i.instanceId})),...target.map(instance=>({type:"add" as const,instance}))];
    return submit(commands,kind);
  };
  return {
    subscribe: (fn:()=>void) => { listeners.add(fn); return ()=>listeners.delete(fn); },
    getSnapshot: ()=>state,
    load,
    submit: (edit: SceneEdit)=>submit([edit]),
    undo: ()=>restore("undo"), redo: ()=>restore("redo"),
    setActive: (value:boolean)=>{active=value;},
    retry: ()=>pending ? sendPending() : load(false,true),
    dispose: ()=>{disposed=true;abort?.abort();listeners.clear();},
  };
}

export function useRoomSession(roomId: string, interactionActive: boolean) {
  // Effect-owned controller avoids reusing a disposed instance after StrictMode's setup/cleanup probe.
  const ref = useRef<ReturnType<typeof createRoomSession> | null>(null);
  const bridge = useMemo(() => {
    let state: RoomSessionState = {snapshot:null,status:"loading",message:"Opening saved layout…",canUndo:false,canRedo:false};
    const listeners=new Set<()=>void>();
    return {getSnapshot:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);},publish:(next:RoomSessionState)=>{state=next;listeners.forEach(fn=>fn());}};
  },[roomId]);
  const state=useSyncExternalStore(bridge.subscribe,bridge.getSnapshot);
  useEffect(()=>{
    const controller=createRoomSession(roomId);ref.current=controller;
    const unsubscribe=controller.subscribe(()=>bridge.publish(controller.getSnapshot()));
    void controller.load();
    const interval=setInterval(()=>void controller.load(),2500);
    return()=>{clearInterval(interval);unsubscribe();controller.dispose();if(ref.current===controller)ref.current=null;};
  },[roomId,bridge]);
  useEffect(()=>{ref.current?.setActive(interactionActive);},[interactionActive,roomId]);
  const actions=useMemo(()=>({
    submit:(edit:SceneEdit)=>ref.current?.submit(edit) ?? Promise.resolve(false),
    undo:()=>ref.current?.undo(),redo:()=>ref.current?.redo(),retry:()=>ref.current?.retry(),reload:()=>ref.current?.load(true),
  }),[]);
  return {...state,...actions};
}
