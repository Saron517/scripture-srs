import { describe, expect, it } from 'vitest';

import {
  type Card,
  createCard,
  DEFAULT_CONFIG,
  isDue,
  review,
  selectDueQueue,
} from '../src/scheduler/leitner.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 1, 9, 0, 0);

function cardAtBox(box: Card['box'], overrides: Partial<Card> = {}): Card {
  return { box, dueAt: NOW, lastReviewedAt: NOW - DAY, reviewCount: 3, ...overrides };
}

describe('createCard', () => {
  it('starts at box 0, due now, never reviewed', () => {
    expect(createCard(1000)).toEqual({
      box: 0,
      dueAt: 1000,
      lastReviewedAt: null,
      reviewCount: 0,
    });
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

describe('grades', () => {
  it('again resets the box to 0 and is due again the same day', () => {
    const { card, log } = review(cardAtBox(4), 'again', NOW);
    expect(card.box).toBe(0);
    expect(log.intervalDays).toBe(0);
    expect(card.dueAt).toBe(NOW); // box 0 = 0 days
  });

  it('good moves up one box, capped at 5', () => {
    expect(review(cardAtBox(0), 'good', NOW).card.box).toBe(1);
    expect(review(cardAtBox(4), 'good', NOW).card.box).toBe(5);
    expect(review(cardAtBox(5), 'good', NOW).card.box).toBe(5);
  });

  it('easy moves up two boxes, capped at 5', () => {
    expect(review(cardAtBox(0), 'easy', NOW).card.box).toBe(2);
    expect(review(cardAtBox(4), 'easy', NOW).card.box).toBe(5);
    expect(review(cardAtBox(5), 'easy', NOW).card.box).toBe(5);
  });

  it('good / easy use the interval of the box they land in', () => {
    expect(review(cardAtBox(0), 'good', NOW).log.intervalDays).toBe(1); // box 1
    expect(review(cardAtBox(1), 'good', NOW).log.intervalDays).toBe(3); // box 2
    expect(review(cardAtBox(0), 'easy', NOW).log.intervalDays).toBe(3); // box 2
    expect(review(cardAtBox(3), 'easy', NOW).log.intervalDays).toBe(60); // box 5
    expect(review(cardAtBox(4), 'good', NOW).card.dueAt).toBe(NOW + 60 * DAY);
  });

  it('hard keeps the box and gives floor(60% of the box interval), min 1 day', () => {
    const hardDays = (box: Card['box']) => review(cardAtBox(box), 'hard', NOW).log.intervalDays;
    expect(hardDays(0)).toBe(1); // floor(0 * .6) -> 0 -> min 1
    expect(hardDays(1)).toBe(1); // floor(1 * .6) -> 0 -> min 1
    expect(hardDays(2)).toBe(1); // floor(3 * .6) -> floor(1.8) -> 1
    expect(hardDays(3)).toBe(4); // floor(7 * .6) -> floor(4.2) -> 4
    expect(hardDays(4)).toBe(12); // floor(21 * .6) -> floor(12.6) -> 12
    expect(hardDays(5)).toBe(36); // floor(60 * .6) -> 36
    expect(review(cardAtBox(4), 'hard', NOW).card.box).toBe(4);
  });
});

describe('purity and clock independence', () => {
  it('never reads an ambient clock — same inputs, same output', () => {
    const card = createCard(0);
    expect(review(card, 'good', 5_000_000)).toEqual(review(card, 'good', 5_000_000));
  });

  it('does not mutate the input card', () => {
    const card = cardAtBox(2);
    const snapshot = { ...card };
    review(card, 'easy', NOW);
    expect(card).toEqual(snapshot);
  });

  it('rejects a non-finite now', () => {
    expect(() => review(createCard(0), 'good', Number.NaN)).toThrow(TypeError);
    expect(() => createCard(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('records before/after box and due in the log', () => {
    const { log } = review(cardAtBox(2, { dueAt: NOW - DAY }), 'good', NOW);
    expect(log).toMatchObject({
      rating: 'good',
      boxBefore: 2,
      boxAfter: 3,
      intervalDays: 7,
      dueBefore: NOW - DAY,
      dueAfter: NOW + 7 * DAY,
      reviewedAt: NOW,
    });
  });
});

describe('config overrides', () => {
  it('accepts a custom hard factor', () => {
    const days = review(cardAtBox(4), 'hard', NOW, { hardFactor: 0.5 }).log.intervalDays;
    expect(days).toBe(10); // floor(21 * 0.5)
  });
});

describe('selectDueQueue', () => {
  const entry = (reference: string, box: Card['box'], dueAt: number) => ({
    reference,
    card: { box, dueAt, lastReviewedAt: null, reviewCount: 0 } as Card,
  });

  it('drops cards that are not yet due', () => {
    const q = selectDueQueue(
      [entry('A', 0, NOW - DAY), entry('B', 0, NOW + DAY)],
      NOW,
    );
    expect(q.map((e) => e.reference)).toEqual(['A']);
  });

  it('orders by most overdue, then lowest box, then reference A-Z', () => {
    const q = selectDueQueue(
      [
        entry('Psalm 23:1', 2, NOW - DAY),
        entry('John 3:16', 5, NOW - 3 * DAY), // most overdue
        entry('Acts 1:8', 0, NOW - DAY), // same due, lowest box
        entry('Mark 1:1', 4, NOW - DAY),
        entry('Amos 5:24', 0, NOW - DAY), // same due AND same box as Acts -> A-Z
      ],
      NOW,
    );
    expect(q.map((e) => e.reference)).toEqual([
      'John 3:16', // most overdue (3 days)
      'Acts 1:8', // box 0; "Acts" < "Amos"
      'Amos 5:24', // box 0
      'Psalm 23:1', // box 2
      'Mark 1:1', // box 4
    ]);
  });

  it('caps the queue at dailyCap', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      entry(`ref ${String(i).padStart(2, '0')}`, 0, NOW - DAY),
    );
    expect(selectDueQueue(many, NOW)).toHaveLength(DEFAULT_CONFIG.dailyCap);
    expect(selectDueQueue(many, NOW, { dailyCap: 5 })).toHaveLength(5);
  });
});
