import type { CSSProperties } from "react";
export type IconName =
  | "camera"
  | "plus"
  | "move"
  | "undo"
  | "redo"
  | "rotate"
  | "reset"
  | "cube"
  | "top"
  | "trash"
  | "close"
  | "chevron"
  | "grid"
  | "chair";
const paths: Record<IconName, React.ReactNode> = {
  camera: <><path d="M8 5 9.5 3h5L16 5h4a1 1 0 0 1 1 1v13H3V6a1 1 0 0 1 1-1h4Z" /><circle cx="12" cy="12" r="4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  move: (
    <>
      <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
    </>
  ),
  undo: <path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-3" />,
  redo: <path d="m16 4 5 5-5 5M21 9H10a6 6 0 0 0 0 12h3" />,
  rotate: (
    <>
      <path d="M20 10a8 8 0 1 0-2 8M20 3v7h-7" />
    </>
  ),
  reset: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
    </>
  ),
  cube: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12 4 7.5M12 12v9" />
    </>
  ),
  top: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M9 4v5H4m11 11v-5h5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  chevron: <path d="m8 5 7 7-7 7" />,
  grid: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18m6-18v18M3 9h18M3 15h18" />
    </>
  ),
  chair: (
    <>
      <path d="M6 13V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8M4 10v7h16v-7M6 17v4m12-4v4M4 13h16" />
    </>
  ),
};
export function Icon({
  name,
  size = 20,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
