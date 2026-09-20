import { designPrice, type DesignVariantSet } from "./designVariants";
import "./design-variants.css";
import { useState } from "react";

export default function DesignVariants({set,activeId,busy,revealing=false,message,onSelect,onLock,onDiscard,onInstruction}:{
  set:DesignVariantSet|null;activeId?:string;busy:boolean;revealing?:boolean;message:string;
  onSelect:(id:string)=>void;onLock:()=>void;onDiscard:()=>void;
  onInstruction:(text:string)=>Promise<unknown>;
}) {
  const [instruction,setInstruction]=useState("");
  if (!set && !message) return null;
  const active = set?.variants.find(variant => variant.id === activeId);
  return <section className="glass design-variants" aria-label="Bedroom design drafts" aria-busy={busy}>
    <div className="design-variants-heading"><strong>{revealing ? "Placing your first design" : set ? "Your three bedrooms" : "Designing your bedroom"}</strong>{set && <span>{designPrice(set.budgetCents)} budget</span>}</div>
    <p className="design-variants-progress" role="status">{message}</p>
    {set && revealing && !busy && <button className="design-discard" onClick={onDiscard}>Discard drafts and retry</button>}
    {set && !revealing && <>
      <div className="design-variant-tabs" role="group" aria-label="Choose a bedroom design">{set.variants.map((variant,index) =>
        <button key={variant.id} type="button" aria-pressed={variant.id === activeId} disabled={busy} onClick={()=>onSelect(variant.id)}>
          <span className="design-variant-number">0{index+1}</span><strong>{variant.label}</strong>
          <span>{variant.instances.length} pieces · {designPrice(variant.totalCents)}</span>
        </button>)}
      </div>
      <p className="design-variant-note">Draft preview · synthetic demo prices · furniture subtotal excludes tax and shipping.</p>
      {set.source === "validated_fallback" && <p className="design-variant-note">{set.message || "Curated combinations with validated fit and budget. AI selection was unavailable."}</p>}
      <form className="design-refinement" onSubmit={event=>{event.preventDefault();if(instruction.trim()&&!busy)void onInstruction(instruction.trim());}}>
        <input aria-label="Refine selected bedroom" placeholder="Make the couch more brown…" value={instruction} maxLength={300} disabled={busy} onChange={event=>setInstruction(event.target.value)}/><button type="submit" disabled={busy||!instruction.trim()}>Update</button>
      </form>
      <div className="design-variant-actions"><button className="button" disabled={busy || !active} onClick={onLock}>Lock in {active?.label ?? "design"} →</button><button className="design-discard" disabled={busy} onClick={onDiscard}>Discard drafts</button></div>
    </>}
  </section>;
}
