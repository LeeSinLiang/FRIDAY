import { useEffect, useRef, useState } from "react";
import type { InteractionCallbacks, InteractionState } from "./scene/playcanvas/contracts";
import { createPlayCanvasRuntime, type PlayCanvasRuntime, type RuntimeStatus } from "./scene/playcanvas/runtime";
import { createSceneInteraction } from "./scene/playcanvas/interaction";
import PlayCanvasCapture from "./scene/PlayCanvasCapture";
import PerformancePanel from "./scene/playcanvas/PerformancePanel";
import { roomVisualKey } from "./scene/buildingFloors";
import { switchBuildingFloor } from "./scene/playcanvas/buildingFloor";

type Props = {captureEnabled?:boolean;state:InteractionState;callbacks:InteractionCallbacks;resetKey:number;onStatus:(status:RuntimeStatus)=>void;onRuntime:(runtime:PlayCanvasRuntime|null)=>void};
export default function PlayCanvasScene(props:Props) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const startedAt=useRef(0);
  const perfEnabled=import.meta.env.DEV && new URLSearchParams(window.location.search).get("perf")==="1";
  const latest=useRef(props);latest.current=props;
  const controller=useRef<ReturnType<typeof createSceneInteraction>|null>(null);
  const [runtime,setRuntime]=useState<PlayCanvasRuntime|null>(null);
  const [ready,setReady]=useState(false);
  const [boundRoomKey,setBoundRoomKey]=useState("");
  const roomKey=`${props.state.room.roomId}:${props.state.room.revision}:${props.state.room.scan?.geometryRevision}:${props.state.room.scan?.visualUrl}`;
  const visualKey=roomVisualKey(props.state.room);
  useEffect(()=>{
    if (!canvas.current) return;
    let cancelled=false;
    let handle:PlayCanvasRuntime|undefined;
    setReady(false);
    // StrictMode cancels its probe effect before this microtask: never start its asset/GPU work.
    queueMicrotask(()=>{
    if(cancelled || !canvas.current)return;
    try {
      startedAt.current=performance.now();
      handle=createPlayCanvasRuntime(canvas.current,{room:latest.current.state.room,onStatus:status=>{
      if(!cancelled){latest.current.onStatus(status);setReady(status.phase==="ready");}
      }});
      const instance=handle;
      setRuntime(instance);latest.current.onRuntime(instance);
      void instance.ready.catch(error=>{if(!cancelled)latest.current.onStatus({phase:"error",message:error instanceof Error ? error.message : "The room could not render."});});
    } catch(error) {
      latest.current.onStatus({phase:"error",message:error instanceof Error ? error.message : "The room could not render."});
    }
    });
    return()=>{
      cancelled=true;controller.current?.dispose();controller.current=null;
      handle?.dispose();latest.current.onRuntime(null);
    };
  },[visualKey]);
  useEffect(()=>{
    if(!ready||!runtime||runtime.disposed)return;
    let cancelled=false;
    const bind=()=>{
      // An aborted capture restores its camera before changing the floor transform.
      if(cancelled||runtime.disposed||runtime.capturing)return;
      runtime.app.off("update",bind);
      try {
      controller.current?.dispose();controller.current=null;
      if(runtime.room.roomId!==latest.current.state.room.roomId)
        switchBuildingFloor(runtime,latest.current.state.room);
      const forward:InteractionCallbacks={
        onSelect:id=>latest.current.callbacks.onSelect(id),
        onCommit:(id,pose,attachment)=>latest.current.callbacks.onCommit(id,pose,attachment),
        onPlace:(id,pose,attachment)=>latest.current.callbacks.onPlace(id,pose,attachment),
        onCancelPlacement:()=>latest.current.callbacks.onCancelPlacement(),
        onPreview:preview=>latest.current.callbacks.onPreview(preview),
        onActiveChange:active=>latest.current.callbacks.onActiveChange(active),
        onModelStatus:(id,status)=>latest.current.callbacks.onModelStatus(id,status),
        onSurfaceStatus:(status,message)=>latest.current.callbacks.onSurfaceStatus?.(status,message),
      };
      controller.current=createSceneInteraction(runtime,latest.current.state,forward);
      setBoundRoomKey(roomKey);
      } catch(error) {
        latest.current.onStatus({phase:"error",message:error instanceof Error ? error.message : "The floor could not open."});
      }
    };
    runtime.app.on("update",bind);bind();
    return()=>{cancelled=true;runtime.app.off("update",bind);};
  },[ready,runtime,roomKey]);
  useEffect(()=>{if(runtime?.room.roomId===props.state.room.roomId)controller.current?.update(props.state);},[props.state,runtime,boundRoomKey]);
  useEffect(()=>{controller.current?.resetView();},[props.resetKey]);
  return <><canvas ref={canvas} className="splat-canvas" aria-label="Interactive room. Click or press F to capture the pointer for Walk; press F or Escape to exit." tabIndex={0}/><PlayCanvasCapture key={roomKey} runtime={runtime} enabled={ready&&boundRoomKey===roomKey&&props.captureEnabled!==false}/>{perfEnabled && runtime && <PerformancePanel runtime={runtime} startedAt={startedAt.current}/>}</>;
}
