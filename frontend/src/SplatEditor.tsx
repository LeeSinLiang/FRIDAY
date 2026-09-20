import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CapturePanel from "./CapturePanel";
import { Icon } from "./Icons";
import { useRoomSession } from "./scene/useRoomSession";
import { validatePlacement } from "./scene/placement";
import { SCENE_UNIT_CM, sceneToCm } from "./scene/units";
import type { CameraMode, FirstPersonCamera, Pose, Product } from "./scene/types";
import type { InteractionCallbacks, InteractionMode, InteractionState, ModelStatus, PlacementPreview } from "./scene/playcanvas/contracts";
import type { PlayCanvasRuntime, RuntimeStatus } from "./scene/playcanvas/runtime";
import "./splat-editor.css";

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

export default function SplatEditor() {
  const [active,setActive]=useState(false);
  const [captureOpen,setCaptureOpen]=useState(false);
  const [mode,setMode]=useState<InteractionMode>("explore");
  const [view,setView]=useState<CameraMode>("perspective");
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [pendingProductId,setPendingProductId]=useState<string|null>(null);
  const [panel,setPanel]=useState<"catalogue"|"inspector"|null>("catalogue");
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
  const requestedRoom = new URLSearchParams(window.location.search).get("room");
  const defaultRoom = import.meta.env.VITE_DEFAULT_ROOM_ID === "cg-arch-interior" ? "cg-arch-interior" : "empty-room";
  const session=useRoomSession(requestedRoom === "studio-11" || requestedRoom === "empty-room" || requestedRoom === "cg-arch-interior" || requestedRoom === "cg-arch-lightmapper-proof" ? requestedRoom : defaultRoom,active || !!pendingProductId);
  const snapshot=session.snapshot;
  const room=snapshot?.room;
  const products=snapshot?.products ?? [];
  const instances=snapshot?.instances ?? [];
  const selected=instances.find(i=>i.instanceId===selectedId);
  const product=products.find(p=>p.productId===(pendingProductId ?? selected?.productId));
  const ready=runtimeStatus.phase==="ready" && session.status==="ready";
  const locked=active || session.status==="saving";
  const select=useCallback((id:string|null)=>{setSelectedId(id);setPreview(null);if(id){setMode("place");setPanel("inspector");}else setMode("explore");},[]);
  const cancelPlacement=useCallback(()=>{setPendingProductId(null);setPreview(null);setMode("explore");setNotice("Placement cancelled");},[]);
  const onStatus=useCallback((status:RuntimeStatus)=>setRuntimeStatus(status),[]);
  const onRuntime=useCallback((handle:PlayCanvasRuntime|null)=>{runtime.current=handle;},[]);
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
    const accepted=await session.submit({type:"add",instance:{instanceId:id,productId,pose}});
    if(accepted){setPendingProductId(null);setSelectedId(id);setPanel("inspector");setMode("place");setNotice("Furniture placed");}
    return accepted;
  },[session.submit]);
  const callbacks:InteractionCallbacks=useMemo(()=>({onSelect:select,onCommit:commit,onPlace:place,onCancelPlacement:cancelPlacement,onPreview:setPreview,onActiveChange:setActive,onModelStatus,
    onSurfaceStatus:(status,message)=>setSurfaceNote(status==="error" ? message??"Surface reference could not load" : status==="loading" ? "Loading surface reference…" : message ?? "Surface reference ready"),
  }),[select,commit,place,cancelPlacement,onModelStatus]);
  const state:InteractionState|null=useMemo(()=>room?({room,products,instances,selectedId,pendingProductId,editingEnabled:ready && !captureOpen,snap,mode,view,retries,showSurface}):null,
    [room,products,instances,selectedId,pendingProductId,ready,captureOpen,snap,mode,view,retries,showSurface]);
  useEffect(()=>{if(selectedId && snapshot && !snapshot.instances.some(i=>i.instanceId===selectedId)){setSelectedId(null);setPreview(null);}},[snapshot,selectedId]);
  useEffect(()=>{if(!notice)return;const timeout=setTimeout(()=>setNotice(""),5500);return()=>clearTimeout(timeout);},[notice]);
  const remove=useCallback(async()=>{if(!selectedId||!ready||active)return;const ok=await session.submit({type:"remove",instanceId:selectedId});if(ok){setSelectedId(null);setPreview(null);setMode("explore");setPanel("catalogue");}},[selectedId,ready,active,session.submit]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if(e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable="true"],dialog'))return;
      if(e.key==="Escape" && !active){if(pendingProductId)cancelPlacement();else{setMode("explore");setSelectedId(null);setPreview(null);}return;}
      if(!ready||active||pendingProductId)return;
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?void session.redo():void session.undo();}
      if(e.key==="Delete"||e.key==="Backspace"){e.preventDefault();void remove();}
    };
    window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);
  },[ready,active,pendingProductId,cancelPlacement,session.undo,session.redo,remove]);
  const choose=(item:Product)=>{
    if(!ready||locked)return;
    setSelectedId(null);setPendingProductId(item.productId);setMode("place");setPanel("inspector");setPreview(null);setNotice("");
  };
  const getCamera=useCallback(():FirstPersonCamera|null=>{
    const handle=runtime.current;if(!handle||view!=="perspective")return room?.scan?.defaultCamera??null;
    const position=handle.camera.getPosition(),forward=handle.camera.forward;
    return {kind:"firstPerson",xCm:sceneToCm(position.x),yCm:sceneToCm(position.y),zCm:sceneToCm(position.z),yawRad:Math.atan2(-forward.x,-forward.z),pitchRad:Math.asin(Math.max(-1,Math.min(1,forward.y))),fovDeg:handle.camera.camera?.fov??60};
  },[view,room]);
  const updatePose=(patch:Partial<Pose>)=>selected?commit(selected.instanceId,{...selected.pose,...patch}):Promise.resolve(false);
  const validLabel=preview?.valid ? "Fits test geometry" : preview?.reason;
  const tone=preview ? preview.valid?"valid":/unknown|unreviewed|unconfirmed|floor/i.test(preview.reason)?"unknown":"invalid" : "";
  const help=pendingProductId ? "Point at the floor · Click to place · Esc to cancel" : active ? "Release to place · Esc to cancel" : mode==="walk" ? "W A S D to walk · Drag to look · Esc to stop" : mode==="place"&&selected ? "Drag your furniture · Esc to explore" : "Drag to look around · Choose furniture to begin";

  return <main className={`splat-editor ${panel?"has-panel":""}`}>
    <div className="splat-room" aria-label="First-person room editor">
      {state && <Suspense fallback={null}><PlayCanvasScene state={state} callbacks={callbacks} resetKey={resetKey} onStatus={onStatus} onRuntime={onRuntime}/></Suspense>}
      {runtimeStatus.phase!=="ready" && <div className="splat-loading" role="status">
        <div className="glass splat-loading-card"><span className="loading-orbit"/><h1>{runtimeStatus.phase==="error"?"Room unavailable":"Come on in."}</h1><p>{runtimeStatus.message}</p>
          {runtimeStatus.progress!==undefined && <progress max={1} value={runtimeStatus.progress} aria-label="Room loading progress"/>}
          {runtimeStatus.phase==="error" && <button className="button" onClick={()=>location.reload()}>Reload room</button>}
          {session.status==="offline" && <><p>{session.message}</p><button className="button" onClick={()=>void session.retry()}>Retry connection</button></>}
        </div>
      </div>}
    </div>
    <header className="glass splat-header">
      <a className="wordmark" href="/" aria-label="FRIDAY room editor">FRIDAY<span className="wordmark-dot">.</span></a>
      <span className="splat-title">{room?.scan?.attribution.title ?? "Empty room"}<span>{room?.scan?.visualFormat === "glb" ? "Interior · mesh room" : "Living space"}</span></span>
      <span className={`splat-save save-${session.status}`} role="status">{session.status==="ready"?"Saved":session.status==="saving"?"Saving…":session.status==="loading"?"Connecting…":session.status==="conflict"?"Layout changed":"Disconnected"}</span>
      {(session.status==="offline"||session.status==="conflict")&&<button className="button" onClick={()=>void(session.status==="conflict"?session.reload():session.retry())}>{session.status==="conflict"?"Reload layout":"Retry"}</button>}
      <button className="splat-reset" disabled={!ready||locked||!!pendingProductId} onClick={()=>setResetKey(k=>k+1)}><Icon name="reset" size={18}/><span>Reset view</span></button>
    </header>
    <nav className="splat-view-controls" aria-label="Room views">
      <div className="glass splat-segmented">
        <button aria-pressed={view==="perspective"} disabled={!ready||locked||!!pendingProductId} onClick={()=>{setView("perspective");setMode("explore");}}><Icon name="cube" size={17}/>Explore</button>
        <button aria-pressed={view==="top"} disabled={!ready||locked||!!pendingProductId} onClick={()=>{setView("top");setMode("place");}}><Icon name="top" size={17}/>Floor plan</button>
      </div>
      <button className={`glass splat-walk ${mode==="walk"?"is-active":""}`} aria-pressed={mode==="walk"} disabled={!ready||locked||view==="top"||!!pendingProductId} onClick={()=>{setMode(mode==="walk"?"explore":"walk");setSelectedId(null);setPreview(null);}}><Icon name="move" size={17}/>{mode==="walk"?"Stop walking":"Walk"}</button>
      {room&&<CapturePanel room={room} getCamera={getCamera} onOpenChange={setCaptureOpen} mode={view} revision={snapshot?.revision??null} canCapture={ready&&!locked&&!pendingProductId}/>}
    </nav>
    {view==="top"&&<div className="glass splat-plan-label">Schematic floor plan · shaded areas are unreviewed</div>}
    {panel&&<aside className="glass splat-panel" aria-label={panel==="catalogue"?"Furniture catalogue":"Furniture properties"}>
      <div className="splat-panel-heading"><h1>{panel==="catalogue"?"Make room for you.":"Your furniture"}</h1><button aria-label="Close furniture panel" className="icon-button" disabled={locked} onClick={()=>setPanel(null)}><Icon name="close" size={18}/></button></div>
      {panel==="catalogue" ? <>
        <p className="splat-panel-intro">A few considered pieces. A space that feels like yours.</p>
        <div className="splat-products">{products.filter(item=>item.catalogueVisible!==false).map(item=><button key={item.productId} className="splat-product" onClick={()=>choose(item)} disabled={!ready||locked}>
          <span className="splat-product-image"><ProductPreview product={item}/><span className="splat-product-add"><Icon name="plus" size={18}/></span></span>
          <span className="splat-product-name">{item.name}</span><span className="splat-product-dimensions">{item.widthCm} × {item.depthCm} × {item.heightCm} cm</span>
          <span className="splat-product-kind">{item.modelUrl?"GLB model":"Dimensioned preview"}</span>
        </button>)}</div>
        {instances.length>0&&<div className="splat-placed-list"><h2>In your layout <span>{instances.length}</span></h2>{instances.map(i=><button key={i.instanceId} onClick={()=>select(i.instanceId)} disabled={locked}>{products.find(p=>p.productId===i.productId)?.name}<Icon name="chevron" size={15}/></button>)}</div>}
      </> : product ? <>
        <button className="splat-back" disabled={locked||!!pendingProductId} onClick={()=>setPanel("catalogue")}><Icon name="chevron" size={14}/>All furniture</button>
        <div className="splat-selected-preview"><ProductPreview product={product}/></div>
        <h2 className="splat-product-title">{product.name}</h2><p className="splat-dimensions">{product.widthCm} × {product.depthCm} × {product.heightCm} cm</p>
        <div className="splat-property-section">
          {selected ? <><h3>Position <span>(cm)</span></h3><div className="splat-coordinates"><PositionField axis="X" value={selected.pose.xCm} disabled={!ready||locked} commit={xCm=>updatePose({xCm})}/><PositionField axis="Z" value={selected.pose.zCm} disabled={!ready||locked} commit={zCm=>updatePose({zCm})}/></div>
          <div className="splat-rotation"><span>Rotation <b>{Math.round(((selected.pose.yawRad*180/Math.PI)%360+360)%360)}°</b></span><button className="button" disabled={!ready||locked} onClick={()=>void updatePose({yawRad:selected.pose.yawRad+Math.PI/2})}><Icon name="rotate" size={17}/>Rotate 90°</button></div></> : <p className="splat-placement-instruction">Move your pointer over the floor. Click when the footprint turns green.</p>}
          <div className="splat-snap"><span>Snap to grid</span><button role="switch" aria-checked={snap} aria-label="Snap furniture to five centimeter grid" className={`splat-switch ${snap?"enabled":""}`} disabled={locked} onClick={()=>setSnap(v=>!v)}><span/></button><span>5 cm</span></div>
        </div>
        <div className={`splat-placement-status ${tone}`} role="status"><span/>{validLabel || (pendingProductId?"Point at the floor":"Select Move to reposition")}</div>
        {pendingProductId?<button className="button splat-cancel" disabled={locked} onClick={cancelPlacement}>Cancel placement</button>:<button className="button splat-remove" disabled={!ready||locked} onClick={()=>void remove()}><Icon name="trash" size={17}/>Remove from room</button>}
        <p className="splat-model-note">{product.modelUrl ? statuses[selectedId??""]==="error"?"Model unavailable · showing dimensions":statuses[selectedId??""]==="loading"?"Loading model…":"Separate, editable GLB" : "Furniture preview · final models coming soon"}</p>
        {selectedId&&statuses[selectedId]==="error"&&<button className="button" onClick={()=>setRetries(old=>({...old,[selectedId]:(old[selectedId]??0)+1}))}>Retry furniture model</button>}
      </> : <div className="splat-empty-properties"><Icon name="chair" size={32}/><p>Select a piece in the room or choose something new.</p><button className="button" onClick={()=>setPanel("catalogue")}>Browse furniture</button></div>}
      <div className="splat-room-note"><span>{room?.roomId === "cg-arch-lightmapper-proof" ? "Lighting proof · partial room" : room?.roomId === "cg-arch-interior" ? "Living-room placement zone" : room?.scan?.visualFormat === "glb" ? "Authored room · exact dimensions" : "Test room · assumed scale"}</span><label><input type="checkbox" checked={showSurface} onChange={e=>setShowSurface(e.target.checked)} disabled={!ready||locked}/>Surface reference</label>{showSurface&&surfaceNote&&<p>{surfaceNote}</p>}</div>
    </aside>}
    <div className="splat-bottom-left"><button className="glass splat-add" disabled={!ready||locked||!!pendingProductId} onClick={()=>setPanel("catalogue")}><Icon name="plus"/>Add furniture</button>
      {room?.scan&&<p className="splat-attribution"><a href={room.scan.attribution.url} target="_blank" rel="noreferrer">{room.scan.attribution.title} · {room.scan.attribution.author}</a><span> · </span><a href={room.scan.attribution.licenseUrl} target="_blank" rel="noreferrer">{room.scan.attribution.license}</a></p>}
    </div>
    <div className="splat-bottom-center"><p className="glass splat-help" aria-live="polite">{notice || (session.status!=="ready"&&session.status!=="loading"?session.message:help)}</p><nav className="glass splat-edit-tools" aria-label="Furniture tools">
      <button aria-pressed={mode==="place"} disabled={!ready||locked||!selected||!!pendingProductId} onClick={()=>setMode("place")}><Icon name="move" size={18}/>Move</button>
      <button disabled={!ready||locked||!selected||!!pendingProductId} onClick={()=>void updatePose({yawRad:selected!.pose.yawRad+Math.PI/2})}><Icon name="rotate" size={18}/>Rotate</button>
      <span/>
      <button aria-label="Undo placement" disabled={!ready||locked||!session.canUndo||!!pendingProductId} onClick={()=>void session.undo()}><Icon name="undo" size={18}/></button>
      <button aria-label="Redo placement" disabled={!ready||locked||!session.canRedo||!!pendingProductId} onClick={()=>void session.redo()}><Icon name="redo" size={18}/></button>
    </nav></div>
  </main>;
}
