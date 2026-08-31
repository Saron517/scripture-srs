import { describe, expect, it } from 'vitest';

import { createCard, isDue, review } from '../src/scheduler/sm2.js';
import { type Card, DAY_MS, DEFAULT_CONFIG, MINUTE_MS } from '../src/scheduler/types.js';

const NOW = Date.UTC(2026, 0, 1, 9, 0, 0);

function reviewStateCard(overrides: Partial<Card> = {}): Card {
  return {
    ...createCard(NOW),
    state: 'review',
    intervalDays: 10,
    easeFactor: 2.5,
    reps: 3,
    lastReviewedAt: NOW - 10 * DAY_MS,
    ...overrides,
  };
}

describe('createCard', () => {
  it('starts a card as new, due immediately, with default ease', () => {
    expect(createCard(1000)).toEqual({
      state: 'new',
      dueAt: 1000,
      intervalDays: 0,
      easeFactor: 2.5,
      reps: 0,
      lapses: 0,
      learningStepIndex: 0,
      lastReviewedAt: null,
    });
  });
});

describe('clock independence', () => {
  it('never reads an ambient clock — same inputs give the same output', () => {
    const card = createCard(0);
    const first = review(card, 'good', 5_000_000);
    const second = review(card, 'good', 5_000_000);
    expect(second).toEqual(first);
  });

  it('does not mutate the input card', () => {
    const card = createCard(0);
    const snapshot = { ...card };
    review(card, 'easy', 1_000);
    expect(card).toEqual(snapshot);
  });

  it('rejects a non-finite `now`', () => {
    expect(() => review(createCard(0), 'good', Number.NaN)).toThrow(TypeError);
    expect(() => review(createCard(0), 'good', Number.POSITIVE_INFINITY)).toThrow(TypeError);
    // @ts-expect-error — `now` is required and must be a number
    expect(() => isDue(createCard(0), undefined)).toThrow(TypeError);
  });
});

describe('learning steps', () => {
  it('new + good walks the step ladder then graduates to review', () => {
    let { card } = review(createCard(NOW), 'good', NOW);
    expect(card.state).toBe('learning');
    expect(card.learningStepIndex).toBe(1);
    expect(card.dueAt).toBe(NOW + 10 * MINUTE_MS);

    ({ card } = review(card, 'good', card.dueAt));
    expect(card.state).toBe('review');
    expect(card.intervalDays).toBe(DEFAULT_CONFIG.graduatingIntervalDays);
    expect(card.reps).toBe(1);
    expect(card.dueAt).toBe(card.lastReviewedAt! + DAY_MS);
  });

  it('again inside learning resets to the first step', () => {
    const { card } = review(createCard(NOW), 'again', NOW);
    expect(card.state).toBe('learning');
    expect(card.learningStepIndex).toBe(0);
    expect(card.dueAt).toBe(NOW + 1 * MINUTE_MS);
  });

  it('easy inside learning graduates immediately at the easy interval', () => {
    const { card } = review(createCard(NOW), 'easy', NOW);
    expect(card.state).toBe('review');
    expect(card.intervalDays).toBe(DEFAULT_CONFIG.easyIntervalDays);
    expect(card.dueAt).toBe(NOW + DEFAULT_CONFIG.easyIntervalDays * DAY_MS);
  });
});

describe('review transitions', () => {
  it('good multiplies the interval by the ease factor', () => {
    const { card, log } = review(reviewStateCard(), 'good', NOW);
    expect(card.intervalDays).toBe(25); // 10 * 2.5
    expect(card.easeFactor).toBe(2.5);
    expect(card.reps).toBe(4);
    expect(log.stateBefore).toBe('review');
    expect(log.elapsedDays).toBe(10);
  });

  it('hard lowers ease and grows the interval only slightly', () => {
    const { card } = review(reviewStateCard(), 'hard', NOW);
    expect(card.easeFactor).toBeCloseTo(2.35, 10);
    expect(card.intervalDays).toBe(12); // 10 * 1.2
  });

  it('easy raises ease and applies the easy bonus', () => {
    const { card } = review(reviewStateCard(), 'easy', NOW);
    expect(card.easeFactor).toBeCloseTo(2.65, 10);
    expect(card.intervalDays).toBe(Math.round(10 * 2.65 * DEFAULT_CONFIG.easyBonus));
  });

  it('again lapses the card into relearning, floors ease, counts the lapse', () => {
    const { card, log } = review(reviewStateCard({ easeFactor: 1.4 }), 'again', NOW);
    expect(card.state).toBe('relearning');
    expect(card.lapses).toBe(1);
    expect(card.easeFactor).toBe(DEFAULT_CONFIG.minEaseFactor); // 1.4 - 0.2, floored
    expect(card.intervalDays).toBe(1);
    expect(card.dueAt).toBe(NOW + 10 * MINUTE_MS);
    expect(log.stateAfter).toBe('relearning');
  });

  it('relearning + good returns the card to review', () => {
    const lapsed = review(reviewStateCard(), 'again', NOW).card;
    const { card } = review(lapsed, 'good', lapsed.dueAt);
    expect(card.state).toBe('review');
    expect(card.intervalDays).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minReviewIntervalDays);
  });

  it('never drops the ease factor below the configured minimum', () => {
    let card = reviewStateCard({ easeFactor: 1.35 });
    for (let i = 0; i < 25; i++) card = review(card, 'hard', NOW).card;
    expect(card.easeFactor).toBe(DEFAULT_CONFIG.minEaseFactor);
  });

  it('never schedules beyond the maximum interval', () => {
    const { card } = review(
      reviewStateCard({ intervalDays: 9_000, easeFactor: 3 }),
      'easy',
      NOW,
    );
    expect(card.intervalDays).toBe(DEFAULT_CONFIG.maximumIntervalDays);
  });

  it('a successful review always pushes the due date out', () => {
    const { card } = review(reviewStateCard({ intervalDays: 1, easeFactor: 1.3 }), 'good', NOW);
    expect(card.intervalDays).toBeGreaterThan(1);
    expect(card.dueAt).toBeGreaterThan(NOW);
  });
});

describe('isDue', () => {
  it('compares dueAt against the supplied instant only', () => {
    const card = createCard(1_000);
    expect(isDue(card, 999)).toBe(false);
    expect(isDue(card, 1_000)).toBe(true);
    expect(isDue(card, 1_001)).toBe(true);
  });
});
