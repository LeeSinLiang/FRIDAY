import assert from "node:assert/strict";
import test from "node:test";
import { BACKOFF_MS, saveQuietly } from "./quietSave";

const harness = (script: { submit: boolean; retries: boolean[]; statuses: string[] }) => {
  const slept: number[] = []; let retried = 0;
  return { slept, retried: () => retried, deps: {
    submit: async () => script.submit,
    retry: async () => script.retries[retried++],
    status: () => script.statuses[Math.min(slept.length - 1, script.statuses.length - 1)],
    sleep: async (ms: number) => { slept.push(ms); },
    cancelled: () => false,
  } };
};

test("an accepted placement needs no retry", async () => {
  const h = harness({ submit: true, retries: [], statuses: [] });
  assert.equal(await saveQuietly(h.deps), "saved");
  assert.deepEqual([h.slept, h.retried()], [[], 0]);
});

test("a storage hiccup is retried on the 0.5 s to 8 s backoff until the server accepts", async () => {
  const h = harness({ submit: false, retries: [false, false, false, false, false, false, true], statuses: ["offline"] });
  assert.equal(await saveQuietly(h.deps), "saved");
  assert.deepEqual(h.slept, [500, 1000, 2000, 4000, 8000, 8000, 8000]);
  assert.equal(BACKOFF_MS.at(-1), 8000);
});

test("a definite refusal is not retried: the session is no longer offline", async () => {
  for (const status of ["ready", "conflict"]) {
    const h = harness({ submit: false, retries: [], statuses: [status] });
    assert.equal(await saveQuietly(h.deps), "rejected");
    assert.equal(h.retried(), 0);
  }
});

test("a retry that ends in a definite refusal stops the loop", async () => {
  const h = harness({ submit: false, retries: [false], statuses: ["offline", "ready"] });
  assert.equal(await saveQuietly(h.deps), "rejected");
  assert.equal(h.retried(), 1);
});
