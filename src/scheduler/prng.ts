/**
 * Small deterministic pseudo-random generator.
 *
 * Used by the 30-day simulation tests so a "learner" can be modelled without
 * touching `Math.random()`. Kept in `src` (not `test`) because the same
 * generator is the right tool if interval fuzzing is ever added to the
 * scheduler: pass in a seeded `rng` rather than reaching for global randomness.
 */

/** mulberry32: fast 32-bit PRNG, returns a float in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
