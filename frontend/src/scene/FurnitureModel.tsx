import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import { Group, Mesh } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { meterGlbToSceneScale } from "./units";

export type ModelStatus = "loading" | "ready" | "error" | "proxy";

// Keep the source hierarchy immutable. Each furniture instance owns a clone;
// geometry/materials remain shared and are never disposed by an instance.
const sources = new Map<string, Promise<Group>>();
function loadSource(url: string) {
  let request = sources.get(url);
  if (!request) {
    request = new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene);
    sources.set(url, request);
    request.catch(() => {
      if (sources.get(url) === request) sources.delete(url);
    });
  }
  return request;
}

export default function FurnitureModel({
  modelUrl,
  retryKey = 0,
  fallback,
  onStatus,
}: {
  modelUrl?: string;
  retryKey?: number;
  fallback: ReactNode;
  onStatus?: (status: ModelStatus) => void;
}) {
  const [loaded, setLoaded] = useState<{ url: string; object: Group } | null>(
    null,
  );
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  const statusCallback = useRef(onStatus);
  statusCallback.current = onStatus;

  useEffect(() => {
    let active = true;
    setLoaded(null);
    setFailedUrl(null);
    if (!modelUrl) return;
    loadSource(modelUrl)
      .then((source) => {
        if (!active) return;
        const object = clone(source) as Group;
        object.traverse((node) => {
          if (node instanceof Mesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });
        setLoaded({ url: modelUrl, object });
        invalidate();
      })
      .catch(() => {
        if (!active) return;
        setFailedUrl(modelUrl);
        invalidate();
      });
    return () => {
      active = false;
    };
  }, [modelUrl, retryKey, invalidate]);

  const object = loaded && loaded.url === modelUrl ? loaded.object : null;
  const status: ModelStatus = !modelUrl
    ? "proxy"
    : object
      ? "ready"
      : failedUrl === modelUrl
        ? "error"
        : "loading";
  useEffect(() => {
    statusCallback.current?.(status);
  }, [status]);
  const scale = useMemo(() => meterGlbToSceneScale(), []);
  return object ? (
    <group scale={scale} dispose={null}>
      <primitive object={object} dispose={null} />
    </group>
  ) : (
    <>{fallback}</>
  );
}
