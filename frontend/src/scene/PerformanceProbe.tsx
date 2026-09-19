import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

export type PerformanceSample = {
  frames: number;
  meanFrameMs: number;
  p95FrameMs: number;
};

/** Opt-in render-loop sampling. Never keeps an idle editor rendering. */
export default function PerformanceProbe({
  active,
  onSample,
}: {
  active: boolean;
  onSample: (sample: PerformanceSample) => void;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const samples = useRef<number[]>([]);
  const lastFrame = useRef<number | null>(null);
  const reporting = useRef(onSample);
  reporting.current = onSample;

  useEffect(() => {
    if (active) {
      samples.current = [];
      lastFrame.current = null;
      invalidate();
    } else {
      const measured = samples.current;
      if (measured.length >= 5) {
        const sorted = [...measured].sort((a, b) => a - b);
        reporting.current({
          frames: measured.length,
          meanFrameMs:
            measured.reduce((sum, ms) => sum + ms, 0) / measured.length,
          p95FrameMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
        });
      }
      samples.current = [];
      lastFrame.current = null;
    }
  }, [active, invalidate]);

  useFrame(() => {
    if (!active) return;
    const now = performance.now();
    if (lastFrame.current !== null) {
      const delta = now - lastFrame.current;
      // Keep long active-frame gaps: dropping them would conceal genuine stalls.
      if (delta > 0) samples.current.push(delta);
    }
    lastFrame.current = now;
    invalidate();
  });
  return null;
}
