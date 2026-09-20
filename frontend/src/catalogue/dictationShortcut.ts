type KeyPress = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "repeat" | "isComposing">;

/** Consume only the explicit dictation chord, including when the search input is focused. */
export function isDictationShortcut(event: KeyPress): boolean {
  return (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey &&
    !event.repeat && !event.isComposing && event.key.toLowerCase() === "d";
}
