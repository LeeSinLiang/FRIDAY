import { useEffect, useRef, useState } from "react";
import type { FirstPersonCamera } from "./types";
import type { ModelStatus } from "./playcanvas/contracts";
import { acceptVariantRefinement, parseDesignVariantSet, type DesignVariantSet } from "./designVariants";
import { MATERIALIZE_COMPLETE_EVENT, MATERIALIZE_PREVIEW_EVENT } from "./playcanvas/materialize";

export function useDesignVariants(roomId: string, statuses: Record<string, ModelStatus>) {
  const [variantSet, setVariantSet] = useState<DesignVariantSet | null>(null);
  const [activeId, setActiveId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [revealCount, setRevealCount] = useState<number | null>(null);
  const [revealError, setRevealError] = useState("");
  const pendingReveal = useRef<((reply: string) => void) | null>(null);
  const operation = useRef(0);
  const inFlight = useRef(false);
  const pendingRequest = useRef<{key:string;requestId:string;camera:FirstPersonCamera|null}|null>(null);
  const controller = useRef<AbortController | null>(null);
  const activeVariant = variantSet?.variants.find(variant => variant.id === activeId) ?? null;
  const revealing = revealCount !== null && !!activeVariant;
  const placing = revealing && !revealError;
  const lastRevealed = activeVariant?.instances[(revealCount ?? 0) - 1];
  const lastStatus = lastRevealed ? statuses[lastRevealed.instanceId] : undefined;
  useEffect(() => {
    operation.current++; inFlight.current = false; controller.current?.abort();
    setVariantSet(null); setActiveId(""); setMessage(""); setBusy(false); setRevealCount(null); setRevealError("");
    return () => {
      operation.current++; controller.current?.abort();
      pendingReveal.current?.("Design request cancelled."); pendingReveal.current = null;
    };
  }, [roomId]);

  // The renderer starts the existing reveal after its GLB loads. Its completion
  // event, including reduced-motion completion, admits the next real furniture item.
  useEffect(() => {
    if (!placing || !activeVariant || revealCount === null) return;
    if (revealCount === 0) { setRevealCount(1); return; }
    const last = activeVariant.instances[revealCount - 1];
    const name = activeVariant.products.find(product => product.productId === last.productId)?.name ?? "This furniture model";
    if (lastStatus === "error" || lastStatus === "proxy") {
      const reply = `${name} could not load. The preview is paused; discard these drafts and try again.`;
      setRevealError(reply); setMessage(reply);
      pendingReveal.current?.(reply); pendingReveal.current = null;
      return;
    }
    if (lastStatus !== "ready") return;
    const complete = (event: Event) => {
      if ((event as CustomEvent<{instanceId: string}>).detail?.instanceId !== last.instanceId) return;
      window.removeEventListener(MATERIALIZE_COMPLETE_EVENT, complete);
      if (revealCount < activeVariant.instances.length) setRevealCount(revealCount + 1);
      else {
        const reply = "Your first design is placed. Three designs are ready to compare; choose one, then lock it in.";
        setRevealCount(null); setMessage(reply);
        pendingReveal.current?.(reply); pendingReveal.current = null;
      }
    };
    window.addEventListener(MATERIALIZE_COMPLETE_EVENT, complete);
    // Explicitly request the first reveal too: a newly initialized layer may
    // have treated its first sync as restored furniture instead of an addition.
    window.dispatchEvent(new CustomEvent(MATERIALIZE_PREVIEW_EVENT, {detail:{instanceId:last.instanceId}}));
    return () => window.removeEventListener(MATERIALIZE_COMPLETE_EVENT, complete);
  }, [placing, activeVariant, revealCount, lastStatus]);

  async function request(path: string, body: unknown, signal: AbortSignal) {
    const token = decodeURIComponent(document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith("csrftoken="))?.slice(10) ?? "");
    if (!token) throw Error("Reload the room to restore its security token.");
    const response = await fetch(`${path}?roomId=${encodeURIComponent(roomId)}`, {
      method:"POST", credentials:"same-origin", cache:"no-store", signal,
      headers:{"Content-Type":"application/json","X-CSRFToken":token,Accept:"application/json"}, body:JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok || json.status === "failed") throw Error(json.error?.message ?? json.message ?? "The designer could not complete this request.");
    return json;
  }

  async function run(text: string, baseRevision: number, camera: FirstPersonCamera | null) {
    if (inFlight.current || revealing) return "Finish or discard the current preview first.";
    inFlight.current = true; setBusy(true);
    const token = ++operation.current;
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 300_000);
    const before = variantSet;
    const selected = activeVariant;
    const key = `${roomId}:${before?.variantSetId ?? baseRevision}:${selected?.id ?? "new"}:${selected?.revision ?? 0}:${text}`;
    if (pendingRequest.current?.key !== key) pendingRequest.current = {key,requestId:crypto.randomUUID(),camera:structuredClone(camera)};
    const requestId = pendingRequest.current.requestId;
    const requestCamera = pendingRequest.current.camera;
    try {
      setMessage(before ? `Refining ${selected?.label ?? "this design"}…` : "Planning three complete bedroom designs…");
      let json = before && selected
        ? await request(`/api/designer/variants/${before.variantSetId}/refine/`, {variantId:selected.id,baseRevision:selected.revision,requestId,text}, abort.signal)
        : await request("/api/designer/variants/", {text,baseRevision,requestId,camera:requestCamera}, abort.signal);
      while (json.status === "running" && token === operation.current) {
        if (typeof json.jobId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(json.jobId)) throw Error("Invalid design job.");
        setMessage(json.message || "Planning and validating your designs…");
        await new Promise(resolve => window.setTimeout(resolve, 1000));
        if (abort.signal.aborted || token !== operation.current) throw Error("The design request was interrupted.");
        json = await request(`/api/designer/variants/${json.jobId}/`, {}, abort.signal);
      }
      if (token !== operation.current) return "Design request cancelled.";
      let next = parseDesignVariantSet(json.variantSet, roomId, before?.baseRevision ?? baseRevision);
      if (before && selected) next = acceptVariantRefinement(before, next, selected.id, json.clarification === true);
      if (before && json.clarification === true) {
        const reply = json.message || "What would you like to change in this design?";
        pendingRequest.current = null;
        setMessage(reply); return reply;
      }
      setRevealError(""); setVariantSet(next); setActiveId(selected?.id ?? next.variants[0].id);
      pendingRequest.current = null;
      setRevealCount(before ? null : 0);
      if (before) {
        const reply = json.message || `${selected!.label} updated. Your other two designs are unchanged.`;
        setMessage(reply); return reply;
      }
      setMessage("Placing the first design, one piece at a time…");
      return await new Promise<string>(resolve => {
        pendingReveal.current = resolve;
        abort.signal.addEventListener("abort", () => {
          const reply = "The design preview was interrupted. Discard these drafts and try again.";
          if (token === operation.current) { setRevealError(reply); setMessage(reply); }
          pendingReveal.current?.(reply); pendingReveal.current = null;
        }, {once:true});
      });
    } catch (error) {
      const reply = error instanceof Error ? error.message : "The designer could not complete this request.";
      if (token === operation.current) setMessage(reply);
      return reply;
    } finally {
      window.clearTimeout(timeout);
      if (token === operation.current) {setBusy(false); inFlight.current = false;}
    }
  }
  return {variantSet,activeVariant,busy,placing,revealing,
    message:placing ? `${lastStatus === "ready" ? "Weaving" : "Loading"} piece ${Math.max(1,revealCount ?? 0)} of ${activeVariant!.instances.length} in ${activeVariant!.label}…` : message,
    instances:activeVariant ? activeVariant.instances.slice(0,revealCount ?? activeVariant.instances.length) : null,
    run,
    select:(id:string) => {if (!inFlight.current && !revealing && variantSet?.variants.some(variant => variant.id === id)) {setActiveId(id);setRevealCount(null);}},
    discard:() => {if (!inFlight.current && !placing) {setVariantSet(null);setActiveId("");setMessage("");setRevealCount(null);setRevealError("");}},
  };
}
