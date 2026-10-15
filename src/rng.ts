// Deterministic PRNG (mulberry32) with the few samplers the reference simulator needs.
// A private copy, so this package has no dependencies.

export type Rng = {
  next: () => number;
  chance: (p: number) => boolean;
  poisson: (mean: number) => number;
  normal: (mean: number, sd: number) => number;
};

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: number | string): Rng {
  let state = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (mean: number, sd: number) => {
    const u = Math.max(next(), 1e-12);
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return {
    next,
    chance: (p) => next() < p,
    normal,
    poisson: (mean) => {
      if (mean <= 0) return 0;
      if (mean > 30) return Math.max(0, Math.round(normal(mean, Math.sqrt(mean))));
      const limit = Math.exp(-mean);
      let k = 0;
      let p = next();
      while (p > limit) {
        k++;
        p *= next();
      }
      return k;
    },
  };
}
