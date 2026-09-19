import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import { captureRequest, type CaptureResult, type CaptureView } from "./scene/captureClient";
import "./capture.css";

type Props = { revision: number | null; canCapture: boolean; mode: CaptureView; };
export default function CapturePanel({ revision, canCapture, mode }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<CaptureView>(mode);
  const [azimuth, setAzimuth] = useState("37");
  const [elevation, setElevation] = useState("35");
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const pending = result?.status === "pending" || result?.status === "rendering";
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (!result || !pending) return;
    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await captureRequest<CaptureResult>(`/api/scene/captures/${result.captureId}/`, undefined, controller.signal);
        if (!cancelled) { setResult(next); setError(""); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Cannot read the capture. Close and try again.");
      }
      if (!cancelled) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 700);
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [result?.captureId, pending]);
  async function capture() {
    if (!canCapture || revision === null || submitting || pending) return;
    const az = Number(azimuth), el = Number(elevation);
    if (view === "perspective" && (!azimuth.trim() || !elevation.trim() || !Number.isFinite(az) || az < -360 || az > 360 || !Number.isFinite(el) || el < 10 || el > 85)) {
      setError("Use an angle between −360° and 360°, and a height angle between 10° and 85°.");
      return;
    }
    const current = ++generation.current;
    setSubmitting(true); setError(""); setResult(null);
    try {
      const next = await captureRequest<CaptureResult>("/api/scene/captures/", {
        requestId: crypto.randomUUID(), baseRevision: revision, view,
        ...(view === "perspective" ? { camera: { azimuthDeg: az, elevationDeg: el } } : {}),
        width: 1024, height: 768,
      });
      if (generation.current === current) setResult(next);
    } catch (e) {
      if (generation.current === current) setError(e instanceof Error ? e.message : "Cannot capture this room.");
    } finally { if (generation.current === current) setSubmitting(false); }
  }
  return <>
    <button ref={trigger} className="glass reset-button" onClick={() => { setView(mode); setOpen(true); }} aria-label="Capture room image">
      <Icon name="camera" /> <span>Capture</span>
    </button>
    <dialog ref={dialog} className="glass capture-dialog" aria-labelledby="capture-heading" onCancel={() => setOpen(false)} onClose={() => { setOpen(false); trigger.current?.focus(); }}>
      <div className="dialog-heading"><h2 id="capture-heading">A view of your room</h2><button className="icon-button" aria-label="Close capture" onClick={() => setOpen(false)}><Icon name="close" /></button></div>
      <p className="capture-intro">Capture the saved layout without changing your workspace view.</p>
      <div className="capture-options">
        <fieldset disabled={submitting || pending}>
          <legend>View</legend>
          <label><input type="radio" name="capture-view" checked={view === "perspective"} onChange={() => setView("perspective")} /> 3D view</label>
          <label><input type="radio" name="capture-view" checked={view === "top"} onChange={() => setView("top")} /> Top view</label>
        </fieldset>
        {view === "perspective" && <div className="capture-angles">
          <label>Angle around room (°)<input type="number" min={-360} max={360} value={azimuth} disabled={pending || submitting} onChange={e => setAzimuth(e.target.value)} /></label>
          <label>Height angle (°)<input type="number" min={10} max={85} value={elevation} disabled={pending || submitting} onChange={e => setElevation(e.target.value)} /></label>
        </div>}
      </div>
      <div className="capture-actions"><button className="button capture-primary" disabled={!canCapture || submitting || pending} onClick={() => void capture()}>{pending || submitting ? "Creating image…" : "Create image"}</button><span>{canCapture ? `Saved revision ${revision}` : "Save your changes before capturing."}</span></div>
      <div role="status" aria-live="polite">
        {error && <p className="capture-error">{error}</p>}
        {pending && <p className="capture-intro">Rendering your selected view. Keep this editor open.</p>}
        {result?.status === "failed" && <p className="capture-error">{result.error?.message || "The image could not be created. Try again."}</p>}
      </div>
      {result?.status === "ready" && result.imageUrl && <figure className="capture-result">
        <img src={result.imageUrl} alt={`${result.view === "top" ? "Top" : "3D"} view of room revision ${result.revision}`} width={result.width} height={result.height} />
        <figcaption><span>Revision {result.revision} · {result.width} × {result.height}{!!result.modelWarnings?.length && " · Contains test shapes or model fallbacks"}</span><a href={result.imageUrl} download={`friday-${result.view}-r${result.revision}.png`}>Download PNG</a></figcaption>
      </figure>}
    </dialog>
  </>;
}
