import { describe, expect, it } from 'vitest';

import { DAY_MS, DEFAULT_CONFIG } from '../src/scheduler/types.js';
import { directionForLanguage } from '../src/i18n/direction.js';
import { runSimulation, SIM_T0 } from './simulate.js';

describe('30-day review simulation', () => {
  it('is fully deterministic for a given seed', () => {
    const a = runSimulation(0xc0ffee);
    const b = runSimulation(0xc0ffee);
    expect(b).toEqual(a);
  });

  it('runs real study sessions across the month', () => {
    const { history, reviewCount } = runSimulation(0xc0ffee);
    const days = new Set(history.map((s) => s.day));

    expect(reviewCount).toBeGreaterThan(30);
    expect(reviewCount).toBeLessThan(400);
    // study happened on most of the 30 days, not all bunched up
    expect(days.size).toBeGreaterThanOrEqual(20);
    expect(Math.max(...days)).toBe(29);
  });

  it('holds every SRS invariant on every transition', () => {
    const { history } = runSimulation(0xc0ffee);

    for (const step of history) {
      const { before, after, rating } = step;

      // time only ever came from `now`
      expect(step.logReviewedAt).toBe(SIM_T0 + step.day * DAY_MS);
      expect(step.logReviewedAt).toBe(step.now);

      // ease floored, interval capped, always scheduled into the future
      expect(after.easeFactor).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minEaseFactor);
      expect(after.intervalDays).toBeLessThanOrEqual(DEFAULT_CONFIG.maximumIntervalDays);
      expect(after.intervalDays).toBeGreaterThanOrEqual(0);
      expect(after.dueAt).toBeGreaterThan(step.now);

      // monotonic counters
      expect(after.reps).toBeGreaterThanOrEqual(before.reps);
      expect(after.lapses).toBeGreaterThanOrEqual(before.lapses);

      // input card must not be mutated
      expect(before).not.toBe(after);

      if (before.state === 'review' && rating === 'again') {
        expect(after.state).toBe('relearning');
        expect(after.lapses).toBe(before.lapses + 1);
      }

      if (before.state === 'review' && (rating === 'good' || rating === 'easy')) {
        expect(after.intervalDays).toBeGreaterThan(before.intervalDays);
      }
    }
  });

  it('produces sensible long-run outcomes per learner profile', () => {
    const { finalCards } = runSimulation(0xc0ffee);

    // Diligent daily learner: graduated and pushed well out.
    const diligent = finalCards['jhn-3-16-en']!;
    expect(diligent.state).toBe('review');
    expect(diligent.reps).toBeGreaterThanOrEqual(4);
    expect(diligent.intervalDays).toBeGreaterThanOrEqual(15);
    expect(diligent.lapses).toBe(0);

    // Leech: keeps failing, ease bottomed out, interval stuck near the floor,
    // lapses piling up — exactly the signal a UI would use to flag/suspend it.
    const leech = finalCards['rom-3-23-ar']!;
    expect(leech.easeFactor).toBe(DEFAULT_CONFIG.minEaseFactor);
    expect(leech.lapses).toBeGreaterThanOrEqual(3);
    expect(leech.intervalDays).toBeLessThanOrEqual(2);

    // Realistic learners made forward progress overall.
    for (const id of ['psa-23-1-en', 'jhn-3-16-zh', 'jhn-3-16-ar', 'jhn-3-16-hi']) {
      const card = finalCards[id]!;
      expect(card.reps).toBeGreaterThan(0);
      expect(['learning', 'review', 'relearning']).toContain(card.state);
    }
  });

  it('keeps each passage in its own script direction', () => {
    const { history } = runSimulation(0xc0ffee);
    const seen = new Map<string, string>();
    for (const step of history) seen.set(step.passageId, step.language);

    expect(directionForLanguage(seen.get('jhn-3-16-ar')!)).toBe('rtl');
    expect(directionForLanguage(seen.get('rom-3-23-ar')!)).toBe('rtl');
    expect(directionForLanguage(seen.get('jhn-3-16-hi')!)).toBe('ltr');
    expect(directionForLanguage(seen.get('jhn-3-16-zh')!)).toBe('ltr');
    expect(directionForLanguage(seen.get('jhn-3-16-en')!)).toBe('ltr');
  });
});
