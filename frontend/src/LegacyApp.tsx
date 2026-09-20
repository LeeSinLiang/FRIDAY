import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useState,
} from "react";
import CapturePanel from "./CapturePanel";
import { Icon } from "./Icons";
import { PRODUCTS, ROOM, ROOM_LABEL } from "./scene/fixtures";
import { productOf, productsWith } from "./scene/products";
import CatalogueShelf from "./catalogue/CatalogueShelf";
import type { PlaceClause } from "./lib/dsl/schema";
import type { Listing } from "./lib/types";
import { instanceFromListing } from "./region/boundary";
import FloorOverlay from "./region/FloorOverlay";
import { useRegion } from "./region/useRegion";
import { SCENE_UNIT_CM } from "./scene/units";
import { canLeaveRoom, useSceneSync } from "./scene/useSceneSync";
import { findOpenPose, validatePlacement } from "./scene/placement";
import type { PlacementPreview } from "./scene/useFurnitureDrag";
import { useSceneEditor } from "./scene/useSceneEditor";
import type { CameraMode, Pose, Product } from "./scene/types";
import type { ModelStatus } from "./Scene";
import type { PerformanceSample } from "./scene/PerformanceProbe";
const Scene = lazy(() => import("./Scene"));
const SceneCaptureWorker = lazy(() => import("./scene/SceneCapture"));
const SplatEditor = lazy(() => import("./SplatEditor"));
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
  onCommit: (value: number) => boolean;
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
    if (!onCommit(n)) setDraft(String(value));
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
            skipBlur.current = true;
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
function LegacyApp() {
  const editor = useSceneEditor(catalogue);
  const { instances, selectedId, select, edit, undo, redo, canUndo, canRedo, replace } =
    editor;
  const [mode, setMode] = useState<CameraMode>("perspective");
  const [resetKey, setResetKey] = useState(0);
  const [snap, setSnap] = useState(true);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const sync = useSceneSync({instances, replace, interactionActive: dragging});
  const [placementPreview, setPlacementPreview] = useState<PlacementPreview | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  // Catalogue placement: hover lights the floor, picking arms it, a click on lit floor places.
  const [hoveredListing, setHoveredListing] = useState<Listing | null>(null);
  const [armedListing, setArmedListing] = useState<Listing | null>(null);
  const [placeClauses, setPlaceClauses] = useState<PlaceClause[]>([]);
  const [yawChoice, setYawChoice] = useState<number | null>(null);
  const sceneProducts = useMemo(() => productsWith(catalogue, instances), [instances]);
  const region = useRegion(armedListing ?? hoveredListing, ROOM, sceneProducts, instances, placeClauses);
  const onTargetRef = placeClauses.find(clause => clause.k === "on" && clause.ref.kind === "instance")?.ref;
  const onTargetId = onTargetRef?.kind === "instance" ? onTargetRef.id : null;
  const onTarget = onTargetId ? instances.find(instance => instance.instanceId === onTargetId) : undefined;
  const supportHeightCm = onTarget ? productOf(onTarget, sceneProducts)?.heightCm ?? 0 : 0;
  const fitting = region ? region.solution.legalCounts.map((count, index) => (count > 0 ? index : -1)).filter((index) => index >= 0) : [];
  const yawIndex = yawChoice !== null && fitting.includes(yawChoice) ? yawChoice : Math.max(region?.solution.bestYawIndex ?? 0, 0);
  // A chosen turn belongs to the item in hand. Hovering other cards, or moving the pointer from the
  // shelf to the floor, must not undo it.
  const turnOwner = armedListing?.id ?? hoveredListing?.id ?? null;
  useEffect(() => setYawChoice(null), [turnOwner]);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const selectedRowRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [api, setApi] = useState("Connecting");
  const [statuses, setStatuses] = useState<Record<string, ModelStatus>>({});
  const [retries, setRetries] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice || dragging) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice, dragging]);
  const [performanceSample, setPerformanceSample] =
    useState<PerformanceSample | null>(null);
  const selected = instances.find((i) => i.instanceId === selectedId);
  const product = selected ? productOf(selected, catalogue) : undefined;
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
  const commitPose = useCallback((instanceId: string, pose: Pose) => {
    const result = validatePlacement(ROOM, catalogue, instances, instanceId, pose);
    if (!result.valid) { setNotice(`${result.reason}. Position unchanged.`); return false; }
    edit({ type: "setPose", instanceId, pose });
    setNotice("Position updated");
    return true;
  }, [edit, instances]);
  const placementChange = useCallback((preview: PlacementPreview | null) => {
    setPlacementPreview(preview);
    if (preview) setNotice(preview.valid ? "" : `${preview.reason}. Choose a clear position; invalid drops return to the previous position.`);
  }, []);
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
      if (draggingRef.current || !sync.ready) return;
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
        setArmedListing(null);
      } else if (event.key.toLowerCase() === "r" && armedListing && fitting.length > 1) {
        event.preventDefault();
        setYawChoice(fitting[(fitting.indexOf(yawIndex) + 1) % fitting.length]);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [edit, redo, undo, select, selectedId, sync.ready, armedListing, fitting, yawIndex]);
  const add = (item: Product) => {
    if (draggingRef.current || !sync.ready) return;
    const instanceId = crypto.randomUUID();
    const positions: Record<string, [number, number]> = {
      sofa: [230, 175],
      table: [290, 320],
      chair: [455, 285],
    };
    const base = positions[item.kind];
    const pose = findOpenPose(ROOM, catalogue, instances, item, {xCm: base[0], zCm: base[1], yawRad: 0}, SCENE_UNIT_CM);
    if (!pose || instances.length >= 100) { setNotice("No free space for this piece. Move or remove an object first."); return; }
    edit({type: "add", instance: {instanceId, productId: item.productId, pose}});
    select(instanceId);
    setCatalogOpen(false);
    setNotice(`${item.name} added`);
  };
  const placeListing = (pose: Pose) => {
    if (!armedListing || draggingRef.current || !sync.ready || instances.length >= 100) return;
    const instance = instanceFromListing(armedListing, crypto.randomUUID(), pose);
    // The overlay only reports poses the solver proved, and the solver asks this same check, so a
    // refusal here is a solver bug. Say so loudly rather than drop an item where the editor forbids it.
    const verdict = validatePlacement(ROOM, sceneProducts, [...instances, instance], instance.instanceId, pose);
    if (!verdict.valid) { console.error("region solver lit a pose the editor refuses", pose, verdict.reason); return; }
    edit({ type: "add", instance });
    select(instance.instanceId);
    setNotice(`${armedListing.title} placed`);
    setArmedListing(null);
    setHoveredListing(null);
  };
  const updatePose = (patch: Partial<Pose>) => {
    if (selected && !draggingRef.current)
      return commitPose(selected.instanceId, { ...selected.pose, ...patch });
    return false;
  };
  const remove = () => {
    if (selected && !draggingRef.current) {
      edit({ type: "remove", instanceId: selected.instanceId });
      setNotice("Object removed");
    }
  };
  return (
    <main className="studio">
      <Suspense fallback={null}><SceneCaptureWorker enabled={sync.ready && QA_PRODUCTS.length === 0} /></Suspense>
      <header className="app-header">
        <a className="wordmark" href="/" aria-label="FRIDAY room editor">
          FRIDAY<span className="wordmark-dot">.</span>
        </a>
        <span className="header-divider" />
        <div className="room-title">
          {ROOM_LABEL}
          <span>
            {ROOM.widthCm} × {ROOM.depthCm} cm
          </span>
        </div>
        <div className="header-right">
          <span className={`local-label sync-${sync.status}`} title={sync.message} role="status">{sync.message}</span>
          {sync.status === "offline" && <button className="button" onClick={sync.retry}>Retry connection</button>}
          {sync.status === "conflict" && <button className="button" onClick={sync.reload}>Reload saved room</button>}
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
              editingEnabled={sync.ready}
              instances={instances}
              products={sceneProducts}
              overlay={
                <FloorOverlay mask={region ? region.solution.masks[yawIndex] : null} armed={armedListing !== null} onPlace={placeListing} supportHeightCm={supportHeightCm} />
              }
              selectedId={selectedId}
              mode={mode}
              resetKey={resetKey}
              snap={snap}
              onSelect={select}
              onCommit={commitPose}
              onPlacementPreview={placementChange}
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
              disabled={dragging || !sync.ready}
              aria-pressed={mode === "perspective"}
              onClick={() => setMode("perspective")}
            >
              <Icon name="cube" />
              3D
            </button>
            <button
              disabled={dragging || !sync.ready}
              aria-pressed={mode === "top"}
              onClick={() => setMode("top")}
            >
              <Icon name="top" />
              Top view
            </button>
          </div>
          <button
            className="glass reset-button"
            disabled={dragging || !sync.ready}
            onClick={() => setResetKey((k) => k + 1)}
          >
            <Icon name="reset" />
            Reset view
          </button>
          <CapturePanel mode={mode} revision={sync.revision} canCapture={sync.status === "saved" && !dragging} />
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
                const item = productOf(instance, catalogue)!;
                return (
                  <button
                    ref={
                      selectedId === instance.instanceId
                        ? selectedRowRef
                        : undefined
                    }
                    key={instance.instanceId}
                    className={`object-row ${selectedId === instance.instanceId ? "selected" : ""}`}
                    disabled={dragging || !sync.ready}
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
            disabled={dragging || !sync.ready}
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
              <fieldset disabled={dragging || !sync.ready}>
                <legend>
                  Position <span>(cm)</span>
                </legend>
                <div className="coordinates">
                  <Coordinate
                    label="X"
                    value={selected.pose.xCm}
                    disabled={dragging || !sync.ready}
                    onCommit={(xCm) => updatePose({ xCm })}
                  />
                  <Coordinate
                    label="Z"
                    value={selected.pose.zCm}
                    disabled={dragging || !sync.ready}
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
                    disabled={dragging || !sync.ready}
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
                disabled={dragging || !sync.ready}
                onClick={() => setSnap((v) => !v)}
              >
                <span />
              </button>
              <span className="snap-value">{SCENE_UNIT_CM} cm</span>
            </div>
            {selected ? (
              <button
                className="remove-button"
                disabled={dragging || !sync.ready}
                onClick={remove}
              >
                <Icon name="trash" size={18} />
                Remove object
              </button>
            ) : (
              <p className="local-note">Automatically saved to this browser’s room.</p>
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
            disabled={!canUndo || dragging || !sync.ready}
            title="Undo (⌘/Ctrl Z)"
          >
            <Icon name="undo" />
            <span>Undo</span>
          </button>
          <button
            onClick={redo}
            disabled={!canRedo || dragging || !sync.ready}
            title="Redo (⌘/Ctrl Shift Z)"
          >
            <Icon name="redo" />
            <span>Redo</span>
          </button>
        </div>
        <div className={`viewport-caption ${placementPreview ? placementPreview.valid ? "placement-valid" : "placement-invalid" : ""}`} role="status">
          <span>
            {dragging
              ? placementPreview?.valid ? "Clear space · Release to place · Esc to cancel" : `${placementPreview?.reason ?? "Checking position"} · Release to return`
              : mode === "top"
                ? "Drag furniture to move · Drag room to pan · Scroll to zoom"
                : "Drag furniture to move · Drag room to orbit · Scroll to zoom"}
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
        {notice.startsWith("No free space") && <p role="alert">{notice}</p>}
        <div className="catalogue-grid">
          {catalogue.filter(item => item.catalogueVisible !== false || QA_PRODUCTS.length > 0).map((item) => (
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
      <CatalogueShelf
        region={region}
        yawIndex={yawIndex}
        armedId={armedListing?.id ?? null}
        disabled={!sync.ready}
        canSwitchRooms={canLeaveRoom(sync, dragging)}
        onHover={setHoveredListing}
        onPick={setArmedListing}
        onPlace={setPlaceClauses}
        supports={instances.flatMap(instance => {
          const product = productOf(instance, sceneProducts);
          return product?.supportSurface ? [{ id: instance.instanceId, name: product.name }] : [];
        })}
      />
      <div className="placement-notice" role="status" aria-live="polite">
        {notice}
      </div>
    </main>
  );
}

export default function App() {
  return <LegacyApp/>;
}
