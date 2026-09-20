import { useEffect, useState } from "react";
import { waitForSplatFrame, type PlayCanvasRuntime } from "./runtime";

type Snapshot = { loadMs: number | null; fps: number | null; p95: number | null; samples: number; seconds: number; width: number; height: number; state: string };
const initial: Snapshot = { loadMs: null, fps: null, p95: null, samples: 0, seconds: 0, width: 0, height: 0, state: "Loading" };

/** Opt-in development observer; it never drives the camera or schedules frames. */
export default function PerformancePanel({ runtime, startedAt }: { runtime: PlayCanvasRuntime; startedAt: number }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  useEffect(() => {
    let cancelled = false, ready = false, failed = false, previous: number | null = null, loadMs: number | null = null;
    const abort = new AbortController();
    const frames: { at: number; ms: number }[] = [];
    setSnapshot(initial);
    const trim = (now: number) => {
      while (frames.length && (frames[0].at < now - 30_000 || frames.length > 8192)) frames.shift();
    };
    const frameEvent = runtime.app.on("frameend", () => {
      if (!ready || document.hidden || runtime.capturing || runtime.disposed) { previous = null; return; }
      const now = performance.now();
      if (previous !== null) frames.push({ at: now, ms: now - previous });
      previous = now;
      trim(now);
    });
    void runtime.ready.then(() => waitForSplatFrame(runtime, 15_000, abort.signal)).then(() => {
      if (!cancelled) { ready = true; loadMs = performance.now() - startedAt; }
    }).catch(() => {
      if (!cancelled) { failed = true; setSnapshot(value => ({ ...value, state: "Load failed" })); }
    });
    const timer = window.setInterval(() => {
      if (cancelled) return;
      trim(performance.now());
      const intervals = frames.map(frame => frame.ms).sort((a, b) => a - b);
      const total = intervals.reduce((sum, ms) => sum + ms, 0);
      setSnapshot({
        loadMs, fps: total > 0 ? intervals.length * 1000 / total : null,
        p95: intervals.length ? intervals[Math.ceil(intervals.length * 0.95) - 1] : null,
        samples: intervals.length, seconds: total / 1000,
        width: runtime.canvas.width, height: runtime.canvas.height,
        state: failed ? "Load failed" : document.hidden ? "Paused: hidden" : runtime.capturing ? "Paused: capture" : ready ? "Observing" : "Loading",
      });
    }, 1000);
    const visibility = () => { previous = null; };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelled = true; abort.abort(); frameEvent.off(); window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [runtime, startedAt]);
  return <aside data-testid="scene-performance" aria-label="Development rendering performance" style={{ position: "absolute", right: 20, bottom: 110, zIndex: 100, pointerEvents: "none", background: "rgba(20,20,20,.88)", color: "white", padding: "12px 16px", borderRadius: 12, font: "12px/1.6 monospace", whiteSpace: "pre-line" }}>
    {`DEV · ${snapshot.state}\nLoad to ready: ${snapshot.loadMs === null ? "pending" : `${Math.round(snapshot.loadMs)} ms`}\nFrame-event FPS: ${snapshot.fps?.toFixed(1) ?? "—"} · p95: ${snapshot.p95?.toFixed(1) ?? "—"} ms\n${snapshot.samples} samples · ${snapshot.seconds.toFixed(1)} s / rolling 30 s\nCanvas: ${snapshot.width} × ${snapshot.height}\nVisible frames only; excludes captures. GPU time not measured.`}
  </aside>;
}
