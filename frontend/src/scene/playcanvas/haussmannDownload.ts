import source from "../../../../shared/haussmann-download.json";
import type { AssetProgress } from "./assets";

type FileSpec = { name: string; bytes: number; sha256: string };
type DownloadCache = Pick<Cache, "match" | "put" | "delete">;
type DownloadSource = { baseUrl: string; files: FileSpec[]; count: number };
export type PreparedSplat = {
  url: string;
  data?: Record<string, unknown>;
  mapUrl?: (name: string) => string;
  release: () => void;
};

const abortIfNeeded = (signal?: AbortSignal) => signal?.throwIfAborted();

async function verified(bytes: ArrayBuffer, file: FileSpec) {
  if (bytes.byteLength !== file.bytes) return false;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("") === file.sha256;
}

/** Pinned public creator files; no login, conversion, server write or arbitrary URL input. */
export async function downloadHaussmann(
  progress: (value: AssetProgress) => void,
  signal?: AbortSignal,
  dependencies: { fetch?: typeof fetch; cache?: DownloadCache | null; source?: DownloadSource } = {},
): Promise<PreparedSplat> {
  const spec = dependencies.source ?? source;
  const request = dependencies.fetch ?? fetch;
  let cache = dependencies.cache;
  if (cache === undefined) {
    try { cache = await caches.open(source.cacheName); } catch { cache = null; }
  }
  const total = spec.files.reduce((sum, file) => sum + file.bytes, 0);
  let complete = 0;
  const blobs = new Map<string, string>();
  let meta: Record<string, unknown> | undefined;
  const release = () => { for (const url of blobs.values()) URL.revokeObjectURL(url); blobs.clear(); };
  try {
    for (const file of spec.files) {
      abortIfNeeded(signal);
      const url = new URL(file.name, spec.baseUrl).href;
      let bytes: ArrayBuffer | undefined;
      progress({ loaded: complete, total, message: "Checking your saved apartment…" });
      try {
        const cached = await cache?.match(url);
        if (cached) {
          const candidate = await cached.arrayBuffer();
          if (await verified(candidate, file)) bytes = candidate;
          else await cache?.delete(url);
        }
      } catch { /* Restricted storage must not prevent opening the room. */ }
      abortIfNeeded(signal);
      if (!bytes) {
        progress({ loaded: complete, total, message: "Downloading your apartment…" });
        // Timeout is per file, and aborting navigation cancels the active request.
        const timedSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(90_000)]);
        const response = await request(url, { signal: timedSignal, credentials: "omit", cache: "no-store" });
        if (!response.ok || !response.body) throw new Error("The room download is unavailable. Check your connection and try again.");
        const reader = response.body.getReader();
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let received = 0;
        try {
          while (true) {
            abortIfNeeded(signal);
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > file.bytes) throw new Error("The room files have changed. Please try again after the app is updated.");
            chunks.push(value);
            progress({ loaded: complete + received, total, message: "Downloading your apartment…" });
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        bytes = await new Blob(chunks).arrayBuffer();
        progress({ loaded: complete + received, total, message: "Checking the download…" });
        if (!await verified(bytes, file)) throw new Error("The room download was incomplete or changed. Please try again.");
        abortIfNeeded(signal);
        try { await cache?.put(url, new Response(bytes)); } catch { /* Continue without persistent storage. */ }
      }
      abortIfNeeded(signal);
      if (file.name === "meta.json") {
        meta = JSON.parse(new TextDecoder().decode(bytes));
        if (meta?.version !== 2 || meta?.count !== spec.count) throw new Error("This download does not match the reviewed apartment.");
      } else blobs.set(file.name, URL.createObjectURL(new Blob([bytes], { type: "image/webp" })));
      complete += file.bytes;
      progress({ loaded: complete, total, message: "Preparing your apartment…" });
    }
    if (!meta) throw new Error("The apartment description is missing.");
    return {
      url: new URL("meta.json", spec.baseUrl).href, data: meta, release,
      mapUrl: name => {
        const url = blobs.get(name);
        if (!url) throw new Error("The apartment references an unknown file.");
        return url;
      },
    };
  } catch (error) {
    release();
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("The download took too long. Check your connection and try again.");
    throw error;
  }
}

export async function prepareHaussmann(
  localUrl: string, progress: (value: AssetProgress) => void, signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<PreparedSplat> {
  progress({ loaded: 0, total: 0, message: "Opening your apartment…" });
  // Static SPA hosts can answer a missing binary with index.html and HTTP 200.
  const response = await request(localUrl, { method: "HEAD", signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]), cache: "no-cache" });
  if (response.ok && !response.headers.get("content-type")?.includes("text/html"))
    return { url: localUrl, release: () => {} };
  if (![404, 410].includes(response.status) && !(response.ok && response.headers.get("content-type")?.includes("text/html")))
    throw new Error("The room server is unavailable. Please try again.");
  return downloadHaussmann(progress, signal, { fetch: request });
}
