import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import Room from "./Room";
import Grid from "./Grid";
import Furniture from "./Furniture";
import SceneLighting from "./SceneLighting";
import type { ModelStatus } from "./FurnitureModel";
import type { Instance, Product } from "./types";
import { buildCaptureCamera } from "./captureCamera";
import { useCaptureWorker, MAX_CAPTURE_PNG_BYTES, type CaptureJob, type CaptureResult } from "./useCaptureWorker";

const noop = () => {};
class CaptureBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function CaptureItem({ instance, product, report }: { instance: Instance; product: Product; report: (id: string, status: ModelStatus) => void }) {
  const onStatus = useCallback((status: ModelStatus) => report(instance.instanceId, status), [instance.instanceId, report]);
  return <Furniture instance={instance} product={product} selected={false} groupRef={noop} onPointerDown={noop} onModelStatus={onStatus} />;
}

function ReadCapture({ settled, onResult, warnings, width, height }: { settled: boolean; onResult: (result: CaptureResult) => void; warnings: string[]; width: number; height: number }) {
  const { gl, scene, camera, invalidate } = useThree();
  const sent = useRef(false);
  useEffect(() => {
    if (!settled || sent.current) return;
    let cancelled = false;
    let nextFrame = 0;
    invalidate();
    const firstFrame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => {
        if (cancelled || sent.current) return;
        try {
          const context = gl.getContext();
          if (context.isContextLost()) throw Error("WebGL context was lost");
          // The capture contract owns pixel dimensions, never DOM measurement
          // or a late ResizeObserver update from the hidden canvas container.
          gl.setPixelRatio(1);
          gl.setSize(width, height, false);
          if (gl.domElement.width !== width || gl.domElement.height !== height)
            throw Error("Unable to allocate the requested capture dimensions");
          gl.render(scene, camera);
          if (gl.info.render.calls === 0 || gl.domElement.width < 1 || gl.domElement.height < 1) throw Error("The capture scene did not render");
          // A successful draw call alone does not prove pixels reached the buffer.
          const pixel = new Uint8Array(4);
          let first: number[] | null = null;
          let varied = false;
          for (const x of [0.2, 0.35, 0.5, 0.65, 0.8]) for (const y of [0.2, 0.35, 0.5, 0.65, 0.8]) {
            context.readPixels(Math.floor(gl.domElement.width * x), Math.floor(gl.domElement.height * y), 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
            if (!first) first = [...pixel];
            else if (pixel[3] > 0 && first.some((value, channel) => channel < 3 && Math.abs(value - pixel[channel]) > 3)) varied = true;
          }
          if (!varied) throw Error("The capture buffer is blank or uniform");
          const imageDataUrl = gl.domElement.toDataURL("image/png");
          if (!imageDataUrl.startsWith("data:image/png;base64,") || imageDataUrl.length < 100) throw Error("The capture image is empty");
          if (imageDataUrl.length > MAX_CAPTURE_PNG_BYTES * 4 / 3 + 22) {
            sent.current = true;
            onResult({ error: { code: "capture_too_large", message: "The PNG exceeds 1.5 MiB. Request a smaller capture." } });
            return;
          }
          sent.current = true;
          onResult({ imageDataUrl, modelWarnings: warnings });
        } catch (error) {
          sent.current = true;
          onResult({ error: { code: "render_failed", message: error instanceof Error ? error.message : "Unable to capture room" } });
        }
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(firstFrame); cancelAnimationFrame(nextFrame); };
  }, [settled, gl, scene, camera, invalidate, warnings, onResult, width, height]);
  return null;
}

function CaptureContents({ job, onResult }: { job: CaptureJob; onResult: (result: CaptureResult) => void }) {
  const [statuses, setStatuses] = useState<Record<string, ModelStatus>>({});
  const report = useCallback((id: string, status: ModelStatus) => {
    setStatuses(current => current[id] === status ? current : { ...current, [id]: status });
  }, []);
  const { room, products, instances } = job.snapshot;
  const settled = instances.every(instance => statuses[instance.instanceId] && statuses[instance.instanceId] !== "loading");
  const warnings = useMemo(() => instances.flatMap(instance => {
    const status = statuses[instance.instanceId];
    return status === "proxy" ? [`${instance.instanceId}: proxy model (no GLB supplied)`]
      : status === "error" ? [`${instance.instanceId}: model load failed; proxy shown`] : [];
  }), [instances, statuses]);
  return <>
    <SceneLighting mode={job.view} />
    <Room room={room} mode={job.view} onFloorClick={noop} />
    <Grid room={room} />
    {instances.map(instance => <CaptureItem key={instance.instanceId} instance={instance} product={products.find(product => product.productId === instance.productId)!} report={report} />)}
    <ReadCapture settled={settled} onResult={onResult} warnings={warnings} width={job.width} height={job.height} />
  </>;
}

function CaptureJobCanvas({ job, complete }: { job: CaptureJob; complete: (id: string, leaseToken: string, result: CaptureResult) => void }) {
  const completed = useRef(false);
  const finish = useCallback((result: CaptureResult) => {
    if (completed.current) return;
    completed.current = true;
    complete(job.captureId, job.leaseToken, result);
  }, [complete, job.captureId, job.leaseToken]);
  const camera = useMemo(() => buildCaptureCamera(job.snapshot.room, job.view, job.width, job.height, job.camera ?? undefined), [job]);
  useEffect(() => {
    const timer = setTimeout(() => finish({ error: { code: "model_timeout", message: "Models or renderer did not become ready within 15 seconds" } }), 15000);
    return () => clearTimeout(timer);
  }, [finish]);
  const onError = useCallback(() => finish({ error: { code: "render_failed", message: "The capture renderer failed" } }), [finish]);
  return <div aria-hidden="true" style={{ position: "fixed", left: -10000, top: 0, width: job.width, height: job.height, pointerEvents: "none", opacity: 0 }}>
    <CaptureBoundary onError={onError}>
      <Canvas camera={camera} shadows frameloop="demand" dpr={1}
        gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" }}
        fallback="WebGL is required to capture the room.">
        <CaptureContents job={job} onResult={finish} />
      </Canvas>
    </CaptureBoundary>
  </div>;
}

/** Mount once alongside the editor after scene bootstrap. Never touches its camera. */
export default function SceneCaptureWorker({ enabled }: { enabled: boolean }) {
  const { job, complete } = useCaptureWorker(enabled);
  return job ? <CaptureBoundary key={`${job.captureId}:${job.leaseToken}`} onError={() => complete(job.captureId, job.leaseToken, { error: { code: "render_failed", message: "Unable to initialize capture scene" } })}>
    <CaptureJobCanvas job={job} complete={complete} />
  </CaptureBoundary> : null;
}
