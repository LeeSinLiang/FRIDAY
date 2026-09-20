// Saving a placement through the server-authoritative room session without ever taking the item
// off the floor for a storage hiccup. The session refuses to commit on a 5xx or a lost response and
// keeps the request (same commandId) for retry(); this drives that retry on the legacy path's
// backoff. It never edits the session: it only calls what the session already exposes.

export const BACKOFF_MS: readonly number[] = [500, 1000, 2000, 4000, 8000];

export type SaveDeps = {
  submit: () => Promise<boolean>;
  retry: () => Promise<unknown> | undefined;
  /** The session's status, read fresh each time. "offline" is the only one that means "uncertain". */
  status: () => string;
  sleep: (ms: number) => Promise<void>;
  cancelled: () => boolean;
};

/** "saved", or "rejected" on a definite refusal (4xx, conflict). Uncertain failures retry forever, quietly. */
export async function saveQuietly({ submit, retry, status, sleep, cancelled }: SaveDeps): Promise<"saved" | "rejected" | "cancelled"> {
  if (await submit()) return "saved";
  for (let attempt = 0; ; attempt++) {
    // The wait also lets the session's status reach React before it is read.
    await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
    if (cancelled()) return "cancelled";
    if (status() !== "offline") return "rejected";
    if ((await retry()) === true) return "saved";
  }
}
