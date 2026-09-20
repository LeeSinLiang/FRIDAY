import { Asset, type Application, type ContainerResource, type Entity } from "playcanvas";

export type AssetProgress = { loaded: number; total: number; message?: string };

/** One registry per graphics device; instances never own the cached GLB resource. */
export class AssetCache {
  private assets = new Map<string, Asset>();
  private pending = new Map<string, Promise<Asset>>();
  private cancellations = new Set<() => void>();
  private disposed = false;

  constructor(private app: Application) {}

  load(url: string, type: "container" | "gsplat" | "texture", progress?: (value: AssetProgress) => void,
    prepared?: { data?: Record<string, unknown>; mapUrl?: (name: string) => string }): Promise<Asset> {
    if (this.disposed) return Promise.reject(new Error("The renderer has been disposed"));
    const key = `${type}:${url}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    // PlayCanvas 2.22's SOG parser supports mapUrl; its Asset options declaration omits it.
    const options = prepared?.mapUrl ? { crossOrigin: "anonymous" as const, mapUrl: prepared.mapUrl } : undefined;
    const asset = new Asset(url.split("/").pop() ?? type, type, { url }, prepared?.data, options);
    this.assets.set(key, asset);
    this.app.assets.add(asset);
    const promise = new Promise<Asset>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer);
        asset.off("load", loaded);
        asset.off("error", failed);
        asset.off("progress", progressed);
        this.cancellations.delete(cancel);
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(asset);
      };
      const loaded = () => finish(this.disposed ? new Error("The renderer has been disposed") : undefined);
      const failed = (error: unknown) => finish(new Error(`Unable to load ${url}: ${String(error)}`));
      const progressed = (loadedBytes: number, totalBytes: number) => progress?.({ loaded: loadedBytes, total: totalBytes });
      const cancel = () => finish(new Error("The renderer has been disposed"));
      this.cancellations.add(cancel);
      asset.on("load", loaded);
      asset.on("error", failed);
      asset.on("progress", progressed);
      timer = setTimeout(() => finish(new Error(`Loading ${url} timed out`)), 90_000);
      this.app.assets.load(asset);
    });
    this.pending.set(key, promise);
    void promise.catch(() => {
      if (this.pending.get(key) !== promise) return;
      this.pending.delete(key);
      this.assets.delete(key);
      this.app.assets.remove(asset);
      asset.unload();
    });
    return promise;
  }

  async loadContainer(url: string): Promise<ContainerResource> {
    const asset = await this.load(url, "container");
    if (!asset.resource) throw new Error(`The model ${url} has no container resource`);
    return asset.resource as ContainerResource;
  }

  async instantiateContainer(url: string): Promise<Entity> {
    const resource = await this.loadContainer(url);
    if (this.disposed) throw new Error("The renderer has been disposed");
    return resource.instantiateRenderEntity();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const cancel of this.cancellations) cancel();
    for (const asset of this.assets.values()) {
      this.app.assets.remove(asset);
      asset.unload();
    }
    this.assets.clear();
    this.pending.clear();
  }
}
