import type { BrowseCategory } from "./catalogue/browse";

const categories = ["AI", "Sofas", "Chairs", "Tables", "Storage", "Lighting", "Rugs", "Decor", "Plants"] as const;
type Category = typeof categories[number];

function CategoryIcon({ category }: { category: Category }) {
  const paths: Record<Category, React.ReactNode> = {
    "AI": <><path d="m12 2 2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5L12 2Z"/><path d="m20 18 .8 2.2L23 21l-2.2.8L20 24l-.8-2.2L17 21l2.2-.8L20 18Z"/></>,
    Sofas: <><path d="M4 12V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M3 11a2 2 0 0 0-2 2v5h22v-5a2 2 0 0 0-2-2M4 18v3m16-3v3M4 14h16"/></>,
    Chairs: <><path d="M5 15V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10M3 12v6h18v-6M5 18v3m14-3v3"/></>,
    Tables: <><ellipse cx="12" cy="7" rx="10" ry="3"/><path d="m7 9-2 12m12-12 2 12M12 10v8"/></>,
    Storage: <><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 10h18M10 3v18m5-6h2"/></>,
    Lighting: <><path d="M9 17h6m-5 3h4m-6-4c-2-2-3-4-3-6a7 7 0 0 1 14 0c0 2-1 4-3 6M12 3V1"/></>,
    Rugs: <><rect x="3" y="4" width="18" height="16" rx="1"/><rect x="6" y="7" width="12" height="10" rx="1"/><path d="M3 7H1m2 4H1m2 4H1m2 4H1m20-12h-2m2 4h-2m2 4h-2m2 4h-2"/></>,
    Decor: <><path d="M8 3h8v3l-2 2c0 3 5 4 5 8a7 7 0 0 1-14 0c0-4 5-5 5-8L8 6V3Z"/><path d="M9 6h6"/></>,
    Plants: <><path d="M6 14h12l-2 8H8l-2-8ZM12 14V4m0 7c-5 0-7-3-6-7 4 0 6 2 6 7Zm0-3c0-4 2-6 6-6 0 4-2 6-6 6Z"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[category]}</svg>;
}

type Props = {
  browseCategory: BrowseCategory;
  onOpenLiveCatalogue: () => void;
  recommendationsActive: boolean;
  onBrowseCategory: (category: BrowseCategory) => void;
  recommendationTargetRef: (node: HTMLDivElement | null) => void;
  collapsed?: boolean;
  onExpand?: () => void;
};

export default function FurnitureCatalogue({ browseCategory, onOpenLiveCatalogue, collapsed = false, onExpand, recommendationsActive, onBrowseCategory, recommendationTargetRef }: Props) {
  const category = recommendationsActive ? "AI" : browseCategory;
  const changeCategory = (next: Category) => {
    if (next === "AI") onOpenLiveCatalogue(); else onBrowseCategory(next);
    if (collapsed) onExpand?.();
  };
  return <div className={`furn-catalogue${collapsed ? " is-collapsed" : ""}`}>
    <div className="furn-main" aria-hidden={collapsed} inert={collapsed}>
      <div className="furn-heading"><h1>{category}</h1></div>
      <div ref={recommendationTargetRef} className="furn-recommendations"/>
    </div>
    <nav className="furn-categories" aria-label="Furniture categories">{categories.map((name) => <button type="button" key={name} className={category === name ? "is-active" : ""} aria-pressed={category === name} onClick={() => changeCategory(name)}><CategoryIcon category={name}/><span>{name}</span></button>)}</nav>
  </div>;
}
