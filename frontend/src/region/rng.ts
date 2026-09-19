// Seeded random numbers for property tests, so a failure reproduces from its seed. (mulberry32)

export type Rng = { next: () => number; int: (low: number, high: number) => number; pick: <T>(items: readonly T[]) => T };

export function seeded(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (low: number, high: number) => low + Math.floor(next() * (high - low + 1));
  return { next, int, pick: (items) => items[int(0, items.length - 1)] };
}
