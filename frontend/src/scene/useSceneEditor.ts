import { useCallback, useEffect, useState } from "react";
import { historyReducer, initialHistory } from "./commands";
import type { Product, SceneEdit } from "./types";

export function useSceneEditor(products: Product[]) {
  const [history, setHistory] = useState(initialHistory);
  const [selection, select] = useState<string | null>(null);
  const edit = useCallback(
    (command: SceneEdit) =>
      setHistory((state) => historyReducer(state, command, products)),
    [products],
  );
  const undo = useCallback(
    () =>
      setHistory((state) => historyReducer(state, { type: "undo" }, products)),
    [products],
  );
  const redo = useCallback(
    () =>
      setHistory((state) => historyReducer(state, { type: "redo" }, products)),
    [products],
  );
  useEffect(() => {
    if (selection && !history.present.some((i) => i.instanceId === selection))
      select(null);
  }, [history.present, selection]);
  const selectedId = history.present.some((i) => i.instanceId === selection)
    ? selection
    : null;
  return {
    instances: history.present,
    selectedId,
    select,
    edit,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
