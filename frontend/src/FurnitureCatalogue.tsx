import { useState, type CSSProperties } from "react";
import { Icon } from "./Icons";
import type { Product } from "./scene/types";

const categories = ["Sofas", "Chairs", "Tables", "Storage", "Lighting", "Rugs", "Decor", "Plants"] as const;
type Category = typeof categories[number];
const sofaFilters = ["All", "Sectionals", "Sofas", "Loveseats", "Modular"] as const;
type SofaFilter = typeof sofaFilters[number];
type CatalogueItem = {
  id: string;
  name: string;
  category: Category;
  group?: SofaFilter;
  price?: string;
  color: string;
  product?: Product;
};

// Sample listings. Sofa concepts resolve to shared fixture products with provisional dimensions.
const concepts: CatalogueItem[] = [
  { id: "concept-kivik", name: "Kivik Modular Sofa", category: "Sofas", group: "Modular", price: "$1,299", color: "#777774" },
  { id: "concept-jatte", name: "Jatte Sectional", category: "Sofas", group: "Sectionals", price: "$1,899", color: "#ded5c8" },
  { id: "concept-sven", name: "Sven Sofa", category: "Sofas", group: "Sofas", price: "$1,499", color: "#67705a" },
  { id: "concept-logan", name: "Logan Sofa", category: "Sofas", group: "Sofas", price: "$1,689", color: "#a86c44" },
  { id: "concept-mellow", name: "Mellow Sectional", category: "Sofas", group: "Sectionals", price: "$2,199", color: "#e2dbd1" },
  { id: "concept-aiden", name: "Aiden Sofa", category: "Sofas", group: "Sofas", price: "$1,599", color: "#545b66" },
  { id: "concept-chair", name: "Lounge chair concept", category: "Chairs", color: "#aa927b" },
  { id: "concept-table", name: "Coffee table concept", category: "Tables", color: "#aa927b" },
  { id: "concept-storage", name: "Storage concept", category: "Storage", color: "#aa927b" },
  { id: "concept-light", name: "Lighting concept", category: "Lighting", color: "#aa927b" },
  { id: "concept-rug", name: "Rug concept", category: "Rugs", color: "#aa927b" },
  { id: "concept-decor", name: "Decor concept", category: "Decor", color: "#aa927b" },
  { id: "concept-plant", name: "Plant concept", category: "Plants", color: "#aa927b" },
];

function CategoryIcon({ category }: { category: Category }) {
  const paths: Record<Category, React.ReactNode> = {
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

function ItemImage({ item }: { item: CatalogueItem }) {
  if (item.product?.thumbnailUrl) return <img src={item.product.thumbnailUrl} alt=""/>;
  if (item.category !== "Sofas") return <span className="furn-concept-icon" aria-hidden="true"><CategoryIcon category={item.category}/></span>;
  return <svg className="furn-sofa-art" viewBox="0 0 320 145" aria-hidden="true" style={{ "--sofa-color": item.color } as CSSProperties}>
    <ellipse cx="160" cy="131" rx="130" ry="7" fill="#40362d" opacity=".09"/>
    <path d="M45 59Q45 43 60 43h200q15 0 15 16v48H45Z" fill="var(--sofa-color)" stroke="#433b32" strokeOpacity=".15"/>
    <path d="M51 73h69v36H51Zm74 0h70v36h-70Zm75 0h69v36h-69Z" fill="#fff" fillOpacity=".12" stroke="#302b27" strokeOpacity=".14"/>
    <rect x="38" y="96" width="244" height="27" rx="10" fill="var(--sofa-color)" stroke="#433b32" strokeOpacity=".18"/>
    <path d="M32 77q-9 0-9 10v30q0 7 8 7h28V90q0-13-14-13Zm256 0q9 0 9 10v30q0 7-8 7h-28V90q0-13 14-13Z" fill="var(--sofa-color)" stroke="#433b32" strokeOpacity=".18"/>
    <path d="M48 124v7m224-7v7" stroke="#49433d" strokeWidth="5"/>
  </svg>;
}

type Props = {
  products: Product[];
  ready: boolean;
  locked: boolean;
  onChoose: (product: Product) => void;
  onOpenLiveCatalogue?: () => void;
  collapsed?: boolean;
  onExpand?: () => void;
};

export default function FurnitureCatalogue({ products, ready, locked, onChoose, onOpenLiveCatalogue, collapsed = false, onExpand }: Props) {
  const [category, setCategory] = useState<Category>("Sofas");
  const [filter, setFilter] = useState<SofaFilter>("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const productById = new Map(products.map((product) => [product.productId, product]));
  const realItems: CatalogueItem[] = products.filter((product) => product.catalogueVisible !== false).map((product) => ({
    id: product.productId, name: product.name, category: product.kind === "chair" ? "Chairs" : product.kind === "table" ? "Tables" : "Sofas",
    group: product.kind === "sofa" ? "Modular" : undefined, color: product.color, product,
  }));
  const visible = [...realItems, ...concepts.map((item) => ({ ...item, product: productById.get(item.id) }))].filter((item) => item.category === category && (category !== "Sofas" || filter === "All" || item.group === filter));
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0];
  const changeCategory = (next: Category) => { setCategory(next); setFilter("All"); setSelectedId(null); setShowDetails(false); if (collapsed) onExpand?.(); };
  const changeFilter = (next: SofaFilter) => { setFilter(next); setSelectedId(null); setShowDetails(false); };
  const toggleFavorite = (id: string) => setFavorites((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return <div className={`furn-catalogue${collapsed ? " is-collapsed" : ""}`}>
    <div className="furn-main" aria-hidden={collapsed} inert={collapsed}>
      <div className="furn-heading"><h1>{category}</h1></div>
      {showDetails && selected ? <div className="furn-details">
        <button type="button" className="furn-details-back" onClick={() => setShowDetails(false)}><Icon name="chevron" size={16}/>Back to {category.toLowerCase()}</button>
        <div className="furn-details-image"><ItemImage item={selected}/></div>
        <p className="furn-overline">{selected.product?.modelUrl ? "Room model available" : selected.product ? "Placement preview" : "Concept preview"}</p>
        <h2>{selected.name}</h2>
        {selected.price && <p className="furn-details-price">{selected.price} <span>sample price</span></p>}
        {selected.product && <p className="furn-details-dimensions">{selected.product.widthCm} × {selected.product.depthCm} × {selected.product.heightCm} cm</p>}
        <p className="furn-details-note">{selected.product?.modelUrl ? "This piece has a room model and can be positioned on the floor." : selected.product ? "This concept can be positioned with provisional dimensions and a stand-in shape. Its price is illustrative." : "This category is a visual stub. Product data and a room model still need to be imported."}</p>
        <button type="button" className="furn-primary" disabled={!selected.product || !ready || locked} onClick={() => selected.product && onChoose(selected.product)}>{selected.product?.modelUrl ? "Add to room" : selected.product ? "Place preview" : "Import coming soon"}<span aria-hidden="true">→</span></button>
      </div> : <>
        {category === "Sofas" && <nav className="furn-filters" aria-label="Sofa types">{sofaFilters.map((name) => <button type="button" key={name} aria-pressed={filter === name} onClick={() => changeFilter(name)}>{name}</button>)}</nav>}
        <div className="furn-results" aria-label={`${category} results`}>
          {visible.length ? visible.map((item) => <div className={`furn-card${selected?.id === item.id ? " is-selected" : ""}`} key={item.id}>
            <button type="button" className="furn-card-select" aria-pressed={selected?.id === item.id} disabled={locked} onPointerEnter={() => setSelectedId(item.id)} onFocus={() => setSelectedId(item.id)} onClick={() => { setSelectedId(item.id); if (item.product && ready) onChoose(item.product); else setShowDetails(true); }}>
              <span className="furn-card-image"><ItemImage item={item}/></span>
              <span className="furn-card-copy"><strong>{item.name}</strong><span>{item.price ?? (item.product?.modelUrl ? "3D model ready" : "Preview only")}</span></span>
            </button>
            <button type="button" className="furn-favorite" aria-label={`${favorites.has(item.id) ? "Remove" : "Save"} ${item.name} ${favorites.has(item.id) ? "from" : "to"} favorites`} aria-pressed={favorites.has(item.id)} onClick={() => toggleFavorite(item.id)}><svg viewBox="0 0 24 24" fill={favorites.has(item.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg></button>
          </div>) : <p className="furn-empty">No {filter.toLowerCase()} previews yet. Choose another sofa type.</p>}
        </div>
        <div className="furn-footer"><button type="button" className="furn-primary" disabled={!selected} onClick={() => setShowDetails(true)}>View details <span aria-hidden="true">→</span></button>{onOpenLiveCatalogue && <button type="button" className="furn-live-search" onClick={onOpenLiveCatalogue}>Search purchasable catalogue</button>}<p>Concept prices and dimensions are samples. Sofa previews use stand-in shapes; other categories await import.</p></div>
      </>}
    </div>
    <nav className="furn-categories" aria-label="Furniture categories">{categories.map((name) => <button type="button" key={name} className={category === name ? "is-active" : ""} aria-pressed={category === name} onClick={() => changeCategory(name)}><CategoryIcon category={name}/><span>{name}</span></button>)}</nav>
  </div>;
}
