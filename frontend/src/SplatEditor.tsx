import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icons";
import FurnitureCatalogue from "./FurnitureCatalogue";
import FloorMap from "./scene/FloorMap";
import SplatCatalogueLayer from "./catalogue/SplatCatalogueLayer";
import { useRoomSession, type RoomSnapshot } from "./scene/useRoomSession";
import { initialRoom } from "./scene/buildingFloors";
import { validatePlacement } from "./scene/placement";
import { instanceToAdd } from "./scene/products";
import { pieceInHand, walkKeyAction } from "./scene/walkKeys";
import { sceneToCm } from "./scene/units";
import type { CameraMode, FirstPersonCamera, Pose, Product } from "./scene/types";
import type { InteractionCallbacks, InteractionMode, InteractionState, ModelStatus, PlacementPreview } from "./scene/playcanvas/contracts";
import type { PlayCanvasRuntime, RuntimeStatus } from "./scene/playcanvas/runtime";
import "./splat-editor.css";
import { useCart } from "./shopping/CartProvider";

const PlayCanvasScene=lazy(()=>import("./PlayCanvasScene"));
function ProductPreview({product}:{product:Product}) {
  if(product.thumbnailUrl)return <img className="splat-product-photo" src={product.thumbnailUrl} alt=""/>;
  return <span className={`furniture-preview preview-${product.kind}`} style={{"--product-color":product.color} as React.CSSProperties} aria-hidden="true"><i/><b/><em/></span>;
}
function PositionField({axis,value,disabled,commit}:{axis:"X"|"Z";value:number;disabled:boolean;commit:(value:number)=>Promise<boolean>}) {
  const [draft,setDraft]=useState(String(value));
  const [error,setError]=useState(false);
  const skip=useRef(false);
  useEffect(()=>{setDraft(String(Math.round(value*100)/100));setError(false);},[value]);
  const save=async()=>{
    if(skip.current){skip.current=false;return;}
    const next=draft.trim()?Number(draft):NaN;
    if(!Number.isFinite(next)){setError(true);return;}
    setError(false);
    if(next!==value && !await commit(next))setDraft(String(value));
  };
  return <label className="splat-coordinate"><span>{axis}</span><input aria-label={`${axis} position in centimeters`} aria-invalid={error} type="number" step={5} value={draft} disabled={disabled} onChange={e=>setDraft(e.target.value)} onBlur={()=>void save()} onKeyDown={e=>{
    if(e.key==="Enter"){void save();skip.current=true;e.currentTarget.blur();}
    if(e.key==="Escape"){skip.current=true;setDraft(String(value));setError(false);e.currentTarget.blur();}
  }}/>{error && <small>Enter a number</small>}</label>;
}

export default function SplatEditor({roomId, shopping = false, observation = false, onObservationReady}:{roomId?:string; shopping?:boolean; observation?:boolean; onObservationReady?:(ready:boolean)=>void} = {}) {
  const {cart, refresh} = useCart();
  const [active,setActive]=useState(false);
  const [mode,setMode]=useState<InteractionMode>("walk");
  const [pointerLocked,setPointerLocked]=useState(false);
  const [view,setView]=useState<CameraMode>("perspective");
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [pendingProductId,setPendingProductId]=useState<string|null>(null);
  const [panel,setPanel]=useState<"catalogue"|"inspector">("catalogue");
  const [panelOpen,setPanelOpen]=useState(false);
  // The language search panel (sentence box, microphone, lit floor). In shopping mode it opens from the furniture
  // catalogue; on the plain editor route (/?room=…) it starts open, because that route IS the search-and-fit demo and
  // there was otherwise no control on it that could ever open the panel.
  const [shopSearchOpen,setShopSearchOpen]=useState(!shopping);
  const [snap,setSnap]=useState(true);
  const [showSurface,setShowSurface]=useState(false);
  const [surfaceNote,setSurfaceNote]=useState("");
  const [preview,setPreview]=useState<PlacementPreview|null>(null);
  const [notice,setNotice]=useState("");
  const [resetKey,setResetKey]=useState(0);
  const [runtimeStatus,setRuntimeStatus]=useState<RuntimeStatus>({phase:"loading",message:"Opening your room…"});
  const [statuses,setStatuses]=useState<Record<string,ModelStatus>>({});
  const [retries,setRetries]=useState<Record<string,number>>({});
  const runtime=useRef<PlayCanvasRuntime|null>(null);
  const selectingUnderLock=useRef(false);
  const roomParams = new URLSearchParams(window.location.search);
  const requestedRoom = roomId ?? roomParams.get("roomId") ?? roomParams.get("room");
  const [activeRoomId,setActiveRoomId]=useState(()=>initialRoom(requestedRoom,roomParams.get("floor")));
  const session=useRoomSession(activeRoomId,active || !!pendingProductId);
  // Keep the building mounted while fetching the next independent floor layout.
  const previousSnapshot=useRef<RoomSnapshot|null>(null);
  if(session.snapshot)previousSnapshot.current=session.snapshot;
  const snapshot=session.snapshot ?? previousSnapshot.current;
  const room=snapshot?.room;
  const products=snapshot?.products ?? [];
  const instances=snapshot?.instances ?? [];
  const selected=instances.find(i=>i.instanceId===selectedId);
  const product=products.find(p=>p.productId===(pendingProductId ?? selected?.productId));
  const ready=runtimeStatus.phase==="ready" && session.status==="ready" && room?.roomId===activeRoomId;
  useEffect(() => { onObservationReady?.(ready); }, [ready, onObservationReady]);
  const locked=active || session.status==="saving";
  const changeFloor=(nextRoomId:string)=>{
    const building=room?.scan?.building;
    const next=building?.levels.find(level=>level.roomId===nextRoomId);
    if(!next||!ready||locked||pendingProductId||runtime.current?.capturing)return;
    if(document.pointerLockElement===runtime.current?.canvas)document.exitPointerLock();
    setSelectedId(null);setPreview(null);setMode("explore");setPanel("catalogue");setShopSearchOpen(false);
    setActiveRoomId(next.roomId);
    const url=new URL(window.location.href);url.searchParams.set("floor",next.floorId);
    window.history.replaceState(null,"",url);
  };
  const captureWalk=useCallback((fromFloorPlan=false)=>{
    const canvas=runtime.current?.canvas;
    if(!canvas||(view!=="perspective"&&!fromFloorPlan)||navigator.userActivation?.isActive===false)return;
    canvas.focus({preventScroll:true});
    void canvas.requestPointerLock().catch(()=>setNotice("Click the room or press W A S D to capture the pointer"));
  },[view]);
  const select=useCallback((id:string|null)=>{
    if(document.pointerLockElement===runtime.current?.canvas){selectingUnderLock.current=true;document.exitPointerLock();}
    setSelectedId(id);setPreview(null);
    if(id){setMode("place");setPanel("inspector");setPanelOpen(true);}
    else {setMode(view==="perspective"?"walk":"place");setPanel("catalogue");setPanelOpen(false);captureWalk();}
  },[view,captureWalk]);
  const cancelPlacement=useCallback(()=>{setPendingProductId(null);setSelectedId(null);setPreview(null);setPanel("catalogue");setPanelOpen(false);setMode(view==="perspective"?"walk":"place");setNotice("Placement cancelled");},[view]);
  const onStatus=useCallback((status:RuntimeStatus)=>setRuntimeStatus(status),[]);
  const onRuntime=useCallback((handle:PlayCanvasRuntime|null)=>{runtime.current=handle;},[]);
  const getRuntime=useCallback(()=>runtime.current,[]);
  const onModelStatus=useCallback((id:string,status:ModelStatus)=>setStatuses(old=>old[id]===status?old:{...old,[id]:status}),[]);
  const commit=useCallback(async(id:string,pose:Pose)=>{
    if(!snapshot)return false;
    const result=validatePlacement(snapshot.room,snapshot.products,snapshot.instances,id,pose);
    if(!result.valid){setNotice(`${result.reason}. Position unchanged.`);return false;}
    const accepted=await session.submit({type:"setPose",instanceId:id,pose});
    if(accepted)setNotice("Position saved");
    return accepted;
  },[snapshot,session.submit]);
  const place=useCallback(async(productId:string,pose:Pose)=>{
    const id=crypto.randomUUID();
    // A catalogue piece listed in the rail must carry its product, as the search panel's add does; a shared one must not.
    const accepted=await session.submit({type:"add",instance:instanceToAdd(id,productId,pose,instances)});
    if(accepted){setPendingProductId(null);setSelectedId(null);setPanel("catalogue");setPanelOpen(false);setMode(view==="perspective"?"walk":"place");setNotice("Furniture placed");captureWalk();}
    return accepted;
  },[session.submit,view,captureWalk,instances]);
  const callbacks:InteractionCallbacks=useMemo(()=>({onSelect:select,onCommit:commit,onPlace:place,onCancelPlacement:cancelPlacement,onPreview:setPreview,onActiveChange:setActive,onModelStatus,
    onSurfaceStatus:(status,message)=>setSurfaceNote(status==="error" ? message??"Surface reference could not load" : status==="loading" ? "Loading surface reference…" : message ?? "Surface reference ready"),
  }),[select,commit,place,cancelPlacement,onModelStatus]);
  const state:InteractionState|null=useMemo(()=>room?({room,products,instances,selectedId,pendingProductId,editingEnabled:ready && !observation,snap,mode,view,retries,showSurface,agentMotion:snapshot?.agentMotion}):null,
    [room,products,instances,selectedId,pendingProductId,ready,snap,mode,view,retries,showSurface,snapshot?.agentMotion,observation]);
  useEffect(()=>{if(selectedId && snapshot && !snapshot.instances.some(i=>i.instanceId===selectedId)){setSelectedId(null);setPreview(null);}},[snapshot,selectedId]);
  useEffect(()=>{if(!notice)return;const timeout=setTimeout(()=>setNotice(""),5500);return()=>clearTimeout(timeout);},[notice]);
  useEffect(()=>{
    const onLockChange=()=>{
      const isLocked=document.pointerLockElement===runtime.current?.canvas;
      setPointerLocked(isLocked);
      if(isLocked)setNotice("");
      if(!isLocked){
        if(selectingUnderLock.current)selectingUnderLock.current=false;
        else setMode(current=>current==="walk"?"explore":current);
      }
    };
    document.addEventListener("pointerlockchange",onLockChange);
    return()=>{document.removeEventListener("pointerlockchange",onLockChange);if(document.pointerLockElement===runtime.current?.canvas)document.exitPointerLock();};
  },[]);
  useEffect(()=>{if(mode!=="walk"&&document.pointerLockElement===runtime.current?.canvas)document.exitPointerLock();},[mode]);
  const stopWalk=useCallback(()=>{setMode("explore");if(document.pointerLockElement===runtime.current?.canvas)document.exitPointerLock();},[]);
  const startWalk=useCallback(()=>{
    // Read at call time: the search panel's hold lives on the engine, not in React state.
    if(!ready||locked||view==="top"||pieceInHand(pendingProductId,runtime.current))return;
    const canvas=runtime.current?.canvas;if(!canvas)return;
    canvas.focus({preventScroll:true});
    setSelectedId(null);setPreview(null);setMode("walk");
    if (navigator.userActivation?.isActive !== false) {
      setNotice("");
      void canvas.requestPointerLock().catch(()=>setNotice("Click the room or press W A S D to capture the pointer"));
    } else {
      setNotice("Click the room or press W A S D to capture the pointer");
    }
  },[ready,locked,view,pendingProductId]);
  const remove=useCallback(async()=>{if(!selectedId||!ready||active)return;const ok=await session.submit({type:"remove",instanceId:selectedId});if(ok){setSelectedId(null);setPreview(null);setMode(view==="perspective"?"walk":"place");setPanel("catalogue");setPanelOpen(false);captureWalk();}},[selectedId,ready,active,session.submit,view,captureWalk]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if (observation) return;
      if(e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable="true"],dialog'))return;
      if(e.key==="Escape" && !e.repeat && !active){
        if(pendingProductId)cancelPlacement();
        else if(mode==="walk"||document.pointerLockElement===runtime.current?.canvas)stopWalk();
        else {setSelectedId(null);setPreview(null);setPanel("catalogue");setPanelOpen(false);setMode(view==="perspective"?"walk":"place");}
        return;
      }
      // F and W A S D do nothing with a piece in hand, the rail's OR the search panel's; Esc above still drops it.
      const walkKey=walkKeyAction(e,{mode,pointerLocked,active,pieceInHand:pieceInHand(pendingProductId,runtime.current)});
      if(walkKey==="toggle"){
        e.preventDefault();
        if(document.pointerLockElement===runtime.current?.canvas)stopWalk();
        else startWalk();
        return;
      }
      if(walkKey==="capture") {
        const canvas=runtime.current?.canvas;
        if(canvas) void canvas.requestPointerLock().then(()=>setNotice("")).catch(()=>setNotice("Pointer capture is unavailable here · Drag to look"));
      }
      if(!ready||active||pendingProductId)return;
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?void session.redo():void session.undo();}
      if(e.key==="Delete"||e.key==="Backspace"){e.preventDefault();void remove();}
    };
    window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);
  },[ready,active,pendingProductId,mode,pointerLocked,cancelPlacement,startWalk,stopWalk,session.undo,session.redo,remove,view,observation]);
  const choose=(item:Product)=>{
    if(!ready||locked)return;
    setShopSearchOpen(false);
    setSelectedId(null);setPendingProductId(item.productId);setMode("place");setPanel("inspector");setPanelOpen(true);setPreview(null);setNotice("");
  };
  const getCamera=useCallback(():FirstPersonCamera|null=>{
    const handle=runtime.current;if(!handle||view!=="perspective")return room?.scan?.defaultCamera??null;
    const position=handle.camera.getPosition(),forward=handle.camera.forward;
    return {kind:"firstPerson",xCm:sceneToCm(position.x),yCm:sceneToCm(position.y),zCm:sceneToCm(position.z),yawRad:Math.atan2(-forward.x,-forward.z),pitchRad:Math.asin(Math.max(-1,Math.min(1,forward.y))),fovDeg:handle.camera.camera?.fov??60};
  },[view,room]);
  const updatePose=(patch:Partial<Pose>)=>selected?commit(selected.instanceId,{...selected.pose,...patch}):Promise.resolve(false);
  const validLabel=preview?.valid ? "Fits test geometry" : preview?.reason;
  const tone=preview ? preview.valid?"valid":/unknown|unreviewed|unconfirmed|floor/i.test(preview.reason)?"unknown":"invalid" : "";
  const help=pendingProductId ? "Point at the floor · Click to place · Esc to cancel" : active ? "Release to place · Esc to cancel" : mode==="walk" ? pointerLocked ? "W A S D to walk · Space to jump · Shift to sprint · F or Esc to stop" : "Click room or press F to capture pointer · Space to jump" : mode==="place"&&selected ? "Drag your furniture · F to walk" : "Drag to look around · F to walk · Choose furniture to begin";

  if (observation) return <div className="splat-editor observation-room" aria-hidden="true" inert>
    <div className="splat-room">{state && <Suspense fallback={null}><PlayCanvasScene captureEnabled={!observation} state={state} callbacks={callbacks} resetKey={resetKey} onStatus={onStatus} onRuntime={onRuntime}/></Suspense>}</div>
  </div>;

  return <main className={`splat-editor ${panelOpen?"has-panel":""}`}>
    <div className="splat-room" aria-label="First-person room editor">
      {state && <Suspense fallback={null}><PlayCanvasScene state={state} callbacks={callbacks} resetKey={resetKey} onStatus={onStatus} onRuntime={onRuntime}/></Suspense>}
      {snapshot?.room.roomId===activeRoomId && <SplatCatalogueLayer key={snapshot.room.roomId} getRuntime={getRuntime} room={snapshot.room} products={snapshot.products} instances={snapshot.instances} ready={ready} locked={locked} submit={session.submit} retry={session.retry} status={session.status} onNotice={setNotice} shopping={shopping} showShelf={shopSearchOpen} onCloseShelf={()=>setShopSearchOpen(false)} confirm={async instance => {const ok = await session.confirm(instance,cart?.revision ?? -1); await refresh(); return ok;}}/>}
      {runtimeStatus.phase!=="ready" && <div className="splat-loading" role="status">
        <div className="glass splat-loading-card"><span className="loading-orbit"/><h1>{runtimeStatus.phase==="error"?"Room unavailable":"Come on in."}</h1><p>{runtimeStatus.message}</p>
          {runtimeStatus.progress!==undefined && <progress max={1} value={runtimeStatus.progress} aria-label="Room loading progress"/>}
          {runtimeStatus.phase==="error" && <button className="button" onClick={()=>location.reload()}>Reload room</button>}
          {session.status==="offline" && <><p>{session.message}</p><button className="button" onClick={()=>void session.retry()}>Retry connection</button></>}
        </div>
      </div>}
    </div>
    {mode==="walk"&&pointerLocked&&<span className="splat-crosshair" aria-hidden="true"/>}
    <header className="glass splat-header">
      <a className="wordmark" href="/" aria-label="FRIDAY room editor">FRIDAY<span className="wordmark-dot">.</span></a>
      <a href="/rooms">Rooms</a><a href="/cart">Cart ({cart?.items.length ?? 0})</a>
      <span className="splat-title">{room?.scan?.attribution.title ?? "Empty room"}<span>{room?.scan?.visualFormat === "glb" ? "Interior · mesh room" : "Living space"}</span></span>
      <span className={`splat-save save-${session.status}`} role="status">{session.status==="ready"?"Saved":session.status==="saving"?"Saving…":session.status==="loading"?"Connecting…":session.status==="conflict"?"Layout changed":"Disconnected"}</span>
      {(session.status==="offline"||session.status==="conflict")&&<button className="button" onClick={()=>void(session.status==="conflict"?session.reload():session.retry())}>{session.status==="conflict"?"Reload layout":"Retry"}</button>}
      <button className="splat-reset" disabled={!ready||locked||!!pendingProductId} onClick={()=>setResetKey(k=>k+1)}><Icon name="reset" size={18}/><span>Reset view</span></button>
    </header>
    <nav className="splat-view-controls" aria-label="Room views">
      <div className="glass splat-segmented">
        <button aria-pressed={view==="perspective"} disabled={!ready||locked||!!pendingProductId} onClick={()=>{setView("perspective");setSelectedId(null);setPreview(null);setMode("walk");captureWalk(true);}}><Icon name="cube" size={17}/>Explore</button>
        <button aria-pressed={view==="top"} disabled={!ready||locked||!!pendingProductId} onClick={()=>{setView("top");setMode("place");}}><Icon name="top" size={17}/>Floor plan</button>
      </div>
      <button className={`glass splat-walk ${mode==="walk"?"is-active":""}`} aria-pressed={mode==="walk"} disabled={!ready||locked||view==="top"||!!pendingProductId} onClick={()=>pointerLocked?stopWalk():startWalk()}><Icon name="move" size={17}/>{pointerLocked?"Stop walking":mode==="walk"?"Capture pointer":"Walk"}</button>
    </nav>
    {view==="top"&&<div className="glass splat-plan-label">Schematic floor plan · shaded areas are unreviewed</div>}
    <button type="button" className={`splat-panel-toggle ${panelOpen?"is-open":"is-collapsed"}`} aria-label={panelOpen?"Collapse furniture panel":"Expand furniture panel"} aria-controls="furniture-panel" aria-expanded={panelOpen} disabled={!ready||locked} onClick={()=>{if(panelOpen)setPanel("catalogue");setPanelOpen(open=>!open);}}><Icon name="chevron" size={20}/></button>
    <aside id="furniture-panel" className={`glass splat-panel ${panel==="catalogue"?"is-catalogue":""} ${panelOpen?"":"is-collapsed"}`} aria-label={panel==="catalogue"?"Furniture catalogue":"Furniture properties"}>
      {panel==="catalogue" ? <FurnitureCatalogue products={products} ready={ready} locked={locked} onChoose={choose} onOpenLiveCatalogue={()=>{setPanelOpen(false);setMode("explore");setShopSearchOpen(true);}} collapsed={!panelOpen} onExpand={()=>setPanelOpen(true)}/> : <>
      <div className="splat-panel-heading"><h1>Your furniture</h1></div>
      {product ? <>
        <button className="splat-back" disabled={locked||!!pendingProductId} onClick={()=>{setPanel("catalogue");setPanelOpen(true);}}><Icon name="chevron" size={14}/>All furniture</button>
        <div className="splat-selected-preview"><ProductPreview product={product}/></div>
        <h2 className="splat-product-title">{product.name}</h2><p className="splat-dimensions">{product.widthCm} × {product.depthCm} × {product.heightCm} cm</p>
        {shopping && selected && (cart?.items.some(i=>i.instanceId===selected.instanceId && i.roomId===room?.roomId) ? <p>In your cart · moving this piece does not change quantity.</p> : product.modelUrl?.startsWith("/models/furniture/") && product.catalogueVisible !== false ? <><p>Not in cart</p><button className="button" disabled={!ready||locked} onClick={async()=>{const ok=await session.confirm(selected,cart?.revision??-1); await refresh(); setNotice(ok?"Added to cart":session.message);}}>Add this piece to cart</button></> : <p>Room preview only. Search the catalogue for a piece with a 3D model.</p>)}
        <div className="splat-property-section">
          {selected ? <><h3>Position <span>(cm)</span></h3><div className="splat-coordinates"><PositionField axis="X" value={selected.pose.xCm} disabled={!ready||locked} commit={xCm=>updatePose({xCm})}/><PositionField axis="Z" value={selected.pose.zCm} disabled={!ready||locked} commit={zCm=>updatePose({zCm})}/></div>
          <div className="splat-rotation"><span>Rotation <b>{Math.round(((selected.pose.yawRad*180/Math.PI)%360+360)%360)}°</b></span><button className="button" disabled={!ready||locked} onClick={()=>void updatePose({yawRad:selected.pose.yawRad+Math.PI/2})}><Icon name="rotate" size={17}/>Rotate 90°</button></div></> : <p className="splat-placement-instruction">Move your pointer over the floor. Click when the footprint turns green.</p>}
          <div className="splat-snap"><span>Snap to grid</span><button role="switch" aria-checked={snap} aria-label="Snap furniture to five centimeter grid" className={`splat-switch ${snap?"enabled":""}`} disabled={locked} onClick={()=>setSnap(v=>!v)}><span/></button><span>5 cm</span></div>
        </div>
        <div className={`splat-placement-status ${tone}`} role="status"><span/>{validLabel || (pendingProductId?"Point at the floor":"Select Move to reposition")}</div>
        {pendingProductId?<button className="button splat-cancel" disabled={locked} onClick={()=>{cancelPlacement();captureWalk();}}>Cancel placement</button>:<button className="button splat-remove" disabled={!ready||locked} onClick={()=>void remove()}><Icon name="trash" size={17}/>Remove from room</button>}
        {selectedId && !pendingProductId && <button className="button" disabled={!ready || locked || runtime.current?.capturing || statuses[selectedId] !== "ready"} onClick={() => window.dispatchEvent(new CustomEvent("friday:preview-furniture-materialize", { detail: { instanceId: selectedId } }))}>Preview summon</button>}
        <p className="splat-model-note">{product.modelUrl ? statuses[selectedId??""]==="error"?"Model unavailable · showing dimensions":statuses[selectedId??""]==="loading"?"Loading model…":"Separate, editable GLB" : "Furniture preview · final models coming soon"}</p>
        {selectedId&&statuses[selectedId]==="error"&&<button className="button" onClick={()=>setRetries(old=>({...old,[selectedId]:(old[selectedId]??0)+1}))}>Retry furniture model</button>}
      </> : <div className="splat-empty-properties"><Icon name="chair" size={32}/><p>Select a piece in the room or choose something new.</p><button className="button" onClick={()=>{setPanel("catalogue");setPanelOpen(true);}}>Browse furniture</button></div>}
      <div className="splat-room-note"><span>{room?.roomId === "cg-arch-lightmapper-proof" ? "Lighting proof · partial room" : room?.roomId === "cg-arch-interior" ? "Living-room placement zone" : room?.scan?.visualFormat === "glb" ? "Authored room · exact dimensions" : "Test room · assumed scale"}</span><label><input type="checkbox" checked={showSurface} onChange={e=>setShowSurface(e.target.checked)} disabled={!ready||locked}/>Surface reference</label>{showSurface&&surfaceNote&&<p>{surfaceNote}</p>}</div>
      </>}
    </aside>
    {room&&view==="perspective"&&<FloorMap room={room} getCamera={getCamera} onFloorChange={changeFloor} floorChangeDisabled={!ready||locked||!!pendingProductId}/>}
    {view==="top"&&room?.scan&&<div className="splat-bottom-left"><p className="splat-attribution"><a href={room.scan.attribution.url} target="_blank" rel="noreferrer">{room.scan.attribution.title} · {room.scan.attribution.author}</a><span> · </span><a href={room.scan.attribution.licenseUrl} target="_blank" rel="noreferrer">{room.scan.attribution.license}</a></p></div>}
    <div className="splat-bottom-center"><p className="glass splat-help" aria-live="polite">{notice || (session.status!=="ready"&&session.status!=="loading"?session.message:help)}</p><nav className="glass splat-edit-tools" aria-label="Furniture tools">
      <button aria-pressed={mode==="place"} disabled={!ready||locked||!selected||!!pendingProductId} onClick={()=>setMode("place")}><Icon name="move" size={18}/>Move</button>
      <button disabled={!ready||locked||!selected||!!pendingProductId} onClick={()=>void updatePose({yawRad:selected!.pose.yawRad+Math.PI/2})}><Icon name="rotate" size={18}/>Rotate</button>
      <span/>
      <button aria-label="Undo placement" disabled={!ready||locked||!session.canUndo||!!pendingProductId} onClick={()=>void session.undo()}><Icon name="undo" size={18}/></button>
      <button aria-label="Redo placement" disabled={!ready||locked||!session.canRedo||!!pendingProductId} onClick={()=>void session.redo()}><Icon name="redo" size={18}/></button>
    </nav></div>
  </main>;
}
