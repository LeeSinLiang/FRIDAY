import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "./Icons";
import { PRODUCTS, ROOM } from "./scene/fixtures";
import { SCENE_UNIT_CM } from "./scene/units";
import { useSceneEditor } from "./scene/useSceneEditor";
import type { CameraMode, Pose, Product } from "./scene/types";
import type { ModelStatus } from "./Scene";
import type { PerformanceSample } from "./scene/PerformanceProbe";
const Scene = lazy(() => import("./Scene"));
const QA_PRODUCTS: Product[] =
  import.meta.env.DEV && new URLSearchParams(location.search).has("testAssets")
    ? [
        {
          productId: "qa-glb",
          name: "GLB scale fixture",
          kind: "table",
          color: "#97a082",
          widthCm: 200,
          depthCm: 100,
          heightCm: 100,
          modelUrl: "/models/test-fixture/model.glb",
        },
        {
          productId: "qa-slow",
          name: "Slow model",
          kind: "table",
          color: "#c47b50",
          widthCm: 200,
          depthCm: 100,
          heightCm: 100,
          modelUrl: "/__test/slow-model.glb",
        },
        {
          productId: "qa-broken",
          name: "Unavailable model",
          kind: "chair",
          color: "#a98458",
          widthCm: 70,
          depthCm: 75,
          heightCm: 75,
          modelUrl: "/models/test-fixture/missing.glb",
        },
      ]
    : [];
const catalogue = [...PRODUCTS, ...QA_PRODUCTS];
const measurePerformance =
  import.meta.env.DEV && new URLSearchParams(location.search).has("perf");
function Preview({ product }: { product: Product }) {
  return (
    <span
      className={`furniture-preview preview-${product.kind}`}
      style={{ "--product-color": product.color } as React.CSSProperties}
      aria-hidden="true"
    >
      <i />
      <b />
      <em />
    </span>
  );
}
function Coordinate({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const skipBlur = useRef(false);
  useEffect(() => {
    setDraft(String(Math.round(value * 100) / 100));
    setInvalid(false);
  }, [value]);
  function commit() {
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }
    const n = draft.trim() ? Number(draft) : NaN;
    if (!Number.isFinite(n)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onCommit(n);
  }
  return (
    <label className="coordinate">
      <span>{label}</span>
      <input
        aria-label={`${label} position in centimeters`}
        aria-invalid={invalid}
        type="number"
        step={SCENE_UNIT_CM}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            skipBlur.current = true;
            setDraft(String(value));
            setInvalid(false);
            e.currentTarget.blur();
          }
        }}
      />
      {invalid && <small>Enter a number</small>}
    </label>
  );
}
export default function App() {
  const editor = useSceneEditor(catalogue);
  const { instances, selectedId, select, edit, undo, redo, canUndo, canRedo } =
    editor;
  const [mode, setMode] = useState<CameraMode>("perspective");
  const [resetKey, setResetKey] = useState(0);
  const [snap, setSnap] = useState(true);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const selectedRowRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [api, setApi] = useState("Connecting");
  const [statuses, setStatuses] = useState<Record<string, ModelStatus>>({});
  const [retries, setRetries] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState("");
  const [performanceSample, setPerformanceSample] =
    useState<PerformanceSample | null>(null);
  const selected = instances.find((i) => i.instanceId === selectedId);
  const product = catalogue.find((p) => p.productId === selected?.productId);
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
  }, [selectedId]);
  const activeChange = useCallback((active: boolean) => {
    draggingRef.current = active;
    document
      .querySelector("canvas")
      ?.dispatchEvent(new CustomEvent("friday-drag", { detail: active }));
    setDragging(active);
  }, []);
  const commitPose = useCallback(
    (instanceId: string, pose: Pose) =>
      edit({ type: "setPose", instanceId, pose }),
    [edit],
  );
  const modelStatus = useCallback(
    (id: string, status: ModelStatus) =>
      setStatuses((old) =>
        old[id] === status ? old : { ...old, [id]: status },
      ),
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health/", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok || (await r.json()).status !== "ok") throw Error();
        setApi("API connected");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setApi("API offline · local editor ready");
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (catalogOpen && !dialog?.open) dialog?.showModal();
    else if (!catalogOpen && dialog?.open) dialog.close();
  }, [catalogOpen]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input,textarea,select,[contenteditable="true"],dialog',
        )
      )
        return;
      if (draggingRef.current) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "y"
      ) {
        event.preventDefault();
        redo();
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedId
      ) {
        event.preventDefault();
        edit({ type: "remove", instanceId: selectedId });
      } else if (event.key === "Escape") {
        select(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [edit, redo, undo, select, selectedId]);
  const add = (item: Product) => {
    if (draggingRef.current) return;
    const instanceId = crypto.randomUUID();
    const positions: Record<string, [number, number]> = {
      sofa: [230, 175],
      table: [290, 320],
      chair: [455, 285],
    };
    const base = positions[item.kind];
    const duplicates = instances.filter(
      (i) => i.productId === item.productId,
    ).length;
    edit({
      type: "add",
      instance: {
        instanceId,
        productId: item.productId,
        pose: {
          xCm: base[0] + duplicates * 25,
          zCm: base[1] + duplicates * 25,
          yawRad: 0,
        },
      },
    });
    select(instanceId);
    setCatalogOpen(false);
    setNotice(`${item.name} added`);
  };
  const updatePose = (patch: Partial<Pose>) => {
    if (selected && !draggingRef.current)
      commitPose(selected.instanceId, { ...selected.pose, ...patch });
  };
  const remove = () => {
    if (selected && !draggingRef.current) {
      edit({ type: "remove", instanceId: selected.instanceId });
      setNotice("Object removed");
    }
  };
  return (
    <main className="studio">
      <header className="app-header">
        <a className="wordmark" href="/" aria-label="FRIDAY room editor">
          FRIDAY<span className="wordmark-dot">.</span>
        </a>
        <span className="header-divider" />
        <div className="room-title">
          Living room
          <span>
            {ROOM.widthCm} × {ROOM.depthCm} cm
          </span>
        </div>
        <div className="header-right">
          <span className="local-label">Local workspace</span>
          <span
            className={`api-status ${api === "API connected" ? "connected" : ""}`}
            title={api}
          >
            <i />
            {api}
          </span>
        </div>
      </header>
      <section className="workspace" aria-label="Room editor">
        <div className="canvas-container" aria-label="Interactive 3D room">
          <Suspense
            fallback={
              <div className="canvas-loading">
                <span className="loading-orbit" />
                <p>Opening your room…</p>
              </div>
            }
          >
            <Scene
              instances={instances}
              products={catalogue}
              selectedId={selectedId}
              mode={mode}
              resetKey={resetKey}
              snap={snap}
              onSelect={select}
              onCommit={commitPose}
              onActiveChange={activeChange}
              onModelStatus={modelStatus}
              retries={retries}
              interactionActive={dragging}
              onPerformanceSample={
                measurePerformance ? setPerformanceSample : undefined
              }
            />
          </Suspense>
        </div>
        <nav className="view-tools" aria-label="Camera views">
          <div className="glass segmented">
            <span
              className={`view-indicator ${mode === "top" ? "at-top" : ""}`}
            />
            <button
              disabled={dragging}
              aria-pressed={mode === "perspective"}
              onClick={() => setMode("perspective")}
            >
              <Icon name="cube" />
              3D
            </button>
            <button
              disabled={dragging}
              aria-pressed={mode === "top"}
              onClick={() => setMode("top")}
            >
              <Icon name="top" />
              Top view
            </button>
          </div>
          <button
            className="glass reset-button"
            disabled={dragging}
            onClick={() => setResetKey((k) => k + 1)}
          >
            <Icon name="reset" />
            Reset view
          </button>
        </nav>
        <aside className="glass inspector" aria-label="Objects and properties">
          <div className="panel-heading">
            <h1>
              Objects{" "}
              <span>{instances.length.toString().padStart(2, "0")}</span>
            </h1>
            <span className="panel-kicker">YOUR ROOM</span>
          </div>
          <div className="object-list">
            {instances.length === 0 ? (
              <div className="empty-list">
                <span className="empty-room-icon">
                  <Icon name="chair" size={30} />
                </span>
                <h2>A little room to imagine.</h2>
                <p>
                  Add your first piece and
                  <br />
                  make this space your own.
                </p>
              </div>
            ) : (
              instances.map((instance, index) => {
                const item = catalogue.find(
                  (p) => p.productId === instance.productId,
                )!;
                return (
                  <button
                    ref={
                      selectedId === instance.instanceId
                        ? selectedRowRef
                        : undefined
                    }
                    key={instance.instanceId}
                    className={`object-row ${selectedId === instance.instanceId ? "selected" : ""}`}
                    disabled={dragging}
                    onClick={() => select(instance.instanceId)}
                    aria-pressed={selectedId === instance.instanceId}
                  >
                    <span className="preview-tile">
                      <Preview product={item} />
                    </span>
                    <span className="object-copy">
                      <strong>{item.name}</strong>
                      <small>
                        {item.widthCm} × {item.depthCm} × {item.heightCm} cm
                      </small>
                    </span>
                    <span className="object-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <button
            ref={addButtonRef}
            className="button add-object"
            disabled={dragging}
            onClick={() => setCatalogOpen(true)}
          >
            <Icon name="plus" />
            Add object
          </button>
          <div className="inspector-rule" />
          {selected && product ? (
            <div className="properties" key={selected.instanceId}>
              <div className="selected-heading">
                <span className="eyebrow">SELECTED OBJECT</span>
                <h2>{product.name}</h2>
                <p>
                  {product.widthCm} × {product.depthCm} × {product.heightCm} cm
                </p>
              </div>
              <fieldset disabled={dragging}>
                <legend>
                  Position <span>(cm)</span>
                </legend>
                <div className="coordinates">
                  <Coordinate
                    label="X"
                    value={selected.pose.xCm}
                    disabled={dragging}
                    onCommit={(xCm) => updatePose({ xCm })}
                  />
                  <Coordinate
                    label="Z"
                    value={selected.pose.zCm}
                    disabled={dragging}
                    onCommit={(zCm) => updatePose({ zCm })}
                  />
                </div>
              </fieldset>
              <div className="rotation-field">
                <span>Rotation</span>
                <div className="rotation-controls">
                  <output aria-label="Rotation">
                    {Math.round(
                      ((((selected.pose.yawRad * 180) / Math.PI) % 360) + 360) %
                        360,
                    )}
                    <span>°</span>
                  </output>
                  <button
                    className="button"
                    disabled={dragging}
                    onClick={() =>
                      updatePose({ yawRad: selected.pose.yawRad + Math.PI / 2 })
                    }
                  >
                    <Icon name="rotate" size={18} />
                    Rotate 90°
                  </button>
                </div>
              </div>
              {statuses[selected.instanceId] === "error" ? (
                <div className="model-note error" role="status">
                  Model unavailable. Showing a test shape.
                  <button
                    onClick={() =>
                      setRetries((old) => ({
                        ...old,
                        [selected.instanceId]:
                          (old[selected.instanceId] ?? 0) + 1,
                      }))
                    }
                  >
                    Retry model
                  </button>
                </div>
              ) : (
                <p className="model-note">
                  {product.modelUrl
                    ? statuses[selected.instanceId] === "ready"
                      ? "3D model loaded"
                      : "Loading model…"
                    : "Test shape · furniture models coming soon"}
                </p>
              )}
            </div>
          ) : (
            <div className="selection-empty">
              <span className="eyebrow">THE DETAILS</span>
              <p>
                {instances.length
                  ? "Select a piece to adjust its position and rotation."
                  : "Your object’s position and dimensions will appear here."}
              </p>
              <div className="room-dimensions">
                <span>Room height</span>
                <strong>{ROOM.heightCm} cm</strong>
              </div>
            </div>
          )}
          <div className="inspector-bottom">
            <div className="snap-row">
              <label htmlFor="snap-toggle">Snap to grid</label>
              <button
                id="snap-toggle"
                className="toggle"
                role="switch"
                aria-checked={snap}
                aria-label="Snap to grid"
                disabled={dragging}
                onClick={() => setSnap((v) => !v)}
              >
                <span />
              </button>
              <span className="snap-value">{SCENE_UNIT_CM} cm</span>
            </div>
            {selected ? (
              <button
                className="remove-button"
                disabled={dragging}
                onClick={remove}
              >
                <Icon name="trash" size={18} />
                Remove object
              </button>
            ) : (
              <p className="local-note">Changes stay in this session.</p>
            )}
          </div>
        </aside>
        <div
          className="glass tool-dock"
          role="toolbar"
          aria-label="Editing tools"
        >
          <span className="move-tool">
            <Icon name="move" />
            <span>Move</span>
          </span>
          <span className="dock-divider" />
          <button
            onClick={undo}
            disabled={!canUndo || dragging}
            title="Undo (⌘/Ctrl Z)"
          >
            <Icon name="undo" />
            <span>Undo</span>
          </button>
          <button
            onClick={redo}
            disabled={!canRedo || dragging}
            title="Redo (⌘/Ctrl Shift Z)"
          >
            <Icon name="redo" />
            <span>Redo</span>
          </button>
        </div>
        <div className="viewport-caption">
          <span>
            {dragging
              ? "Release to place · Esc to cancel"
              : mode === "top"
                ? "Drag to pan · Scroll to zoom"
                : "Drag to orbit · Right-drag to pan · Scroll to zoom"}
          </span>
        </div>
        {measurePerformance && performanceSample && (
          <output className="performance-sample">
            {performanceSample.frames} frames ·{" "}
            {(1000 / performanceSample.meanFrameMs).toFixed(1)} FPS · p95{" "}
            {performanceSample.p95FrameMs.toFixed(1)} ms
          </output>
        )}
        <span className="scene-label">
          <span /> {mode === "top" ? "PLAN VIEW" : "PERSPECTIVE"}
          <span className="scene-label-divider">/</span>01
        </span>
      </section>
      <dialog
        ref={dialogRef}
        className="glass catalogue-dialog"
        onCancel={() => setCatalogOpen(false)}
        onClose={() => {
          setCatalogOpen(false);
          addButtonRef.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setCatalogOpen(false);
        }}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">A PLACE FOR SOMETHING NEW</span>
            <h2>Add to your room</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close furniture picker"
            onClick={() => setCatalogOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="catalogue-intro">
          Explore the layout with these test pieces. Finished furniture models
          will follow.
        </p>
        <div className="catalogue-grid">
          {catalogue.map((item) => (
            <button
              className="catalogue-card"
              key={item.productId}
              onClick={() => add(item)}
            >
              <span className="catalogue-preview">
                <Preview product={item} />
              </span>
              <strong>{item.name}</strong>
              <span>
                {item.widthCm} × {item.depthCm} × {item.heightCm} cm
              </span>
              <small>
                {item.modelUrl ? "Model integration fixture" : "Test shape"}
                <Icon name="plus" size={18} />
              </small>
            </button>
          ))}
        </div>
      </dialog>
      <div className="sr-only" role="status" aria-live="polite">
        {notice}
      </div>
    </main>
  );
}
