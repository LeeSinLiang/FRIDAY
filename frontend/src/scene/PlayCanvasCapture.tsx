import { useEffect } from "react";
import { useCaptureWorker } from "./useCaptureWorker";
import { capturePlayCanvasScene } from "./playcanvas/capture";
import type { PlayCanvasRuntime } from "./playcanvas/runtime";

/** No hidden second WebGL application: captures share the editor's immutable scan resource. */
export default function PlayCanvasCapture({ runtime, enabled }: { runtime: PlayCanvasRuntime | null; enabled: boolean }) {
  const { job, complete } = useCaptureWorker(enabled && !!runtime && !runtime.disposed, runtime?.room.roomId);
  useEffect(() => {
    if (!job || !runtime) return;
    const controller = new AbortController();
    void capturePlayCanvasScene(runtime, job, controller.signal).then(result => {
      if (!controller.signal.aborted) complete(job.captureId, job.leaseToken, result);
    });
    return () => controller.abort();
  }, [job, runtime, complete]);
  return null;
}
