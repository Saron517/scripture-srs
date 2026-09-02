import { describe, expect, it } from 'vitest';

import { createCard, review, type Rating } from '../src/scheduler/leitner.js';

/**
 * Conformance against the workbook's B_Check_Schedule tab.
 *
 *   "Every card starts at box 0 on 2026-09-01. Each grade is applied on the day
 *    the card comes due."
 */
const START = Date.UTC(2026, 8, 1); // 2026-09-01
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface ScheduleCase {
  seq: Rating[];
  endBox: number;
  nextDue: string;
  /** Per-step (box, ISO due date) after each grade, from the Trace column. */
  trace: [number, string][];
}

const CASES: ScheduleCase[] = [
  {
    seq: ['good', 'good', 'good', 'good'],
    trace: [
      [1, '2026-09-02'],
      [2, '2026-09-05'],
      [3, '2026-09-12'],
      [4, '2026-10-03'],
    ],
    endBox: 4,
    nextDue: '2026-10-03',
  },
  {
    seq: ['good', 'again', 'good', 'good'],
    trace: [
      [1, '2026-09-02'],
      [0, '2026-09-02'],
      [1, '2026-09-03'],
      [2, '2026-09-06'],
    ],
    endBox: 2,
    nextDue: '2026-09-06',
  },
  {
    seq: ['easy', 'easy', 'good'],
    trace: [
      [2, '2026-09-04'],
      [4, '2026-09-25'],
      [5, '2026-11-24'],
    ],
    endBox: 5,
    nextDue: '2026-11-24',
  },
  {
    seq: ['good', 'hard', 'hard', 'good'],
    trace: [
      [1, '2026-09-02'],
      [1, '2026-09-03'],
      [1, '2026-09-04'],
      [2, '2026-09-07'],
    ],
    endBox: 2,
    nextDue: '2026-09-07',
  },
  {
    seq: ['again', 'again', 'good', 'easy'],
    trace: [
      [0, '2026-09-01'],
      [0, '2026-09-01'],
      [1, '2026-09-02'],
      [3, '2026-09-09'],
    ],
    endBox: 3,
    nextDue: '2026-09-09',
  },
  {
    seq: ['easy', 'hard', 'good', 'easy'],
    trace: [
      [2, '2026-09-04'],
      [2, '2026-09-05'],
      [3, '2026-09-12'],
      [5, '2026-11-11'],
    ],
    endBox: 5,
    nextDue: '2026-11-11',
  },
  {
    seq: ['good', 'good', 'easy', 'hard', 'good'],
    trace: [
      [1, '2026-09-02'],
      [2, '2026-09-05'],
      [4, '2026-09-26'],
      [4, '2026-10-08'],
      [5, '2026-12-07'],
    ],
    endBox: 5,
    nextDue: '2026-12-07',
  },
  {
    seq: ['hard', 'hard', 'hard'],
    trace: [
      [0, '2026-09-02'],
      [0, '2026-09-03'],
      [0, '2026-09-04'],
    ],
    endBox: 0,
    nextDue: '2026-09-04',
  },
];

describe('B_Check_Schedule conformance', () => {
  CASES.forEach((testCase, i) => {
    it(`#${i + 1}  ${testCase.seq.join(', ')}`, () => {
      let card = createCard(START);
      const steps: [number, string][] = [];

      for (const grade of testCase.seq) {
        // grade applied on the day the card comes due
        card = review(card, grade, card.dueAt).card;
        steps.push([card.box, isoDate(card.dueAt)]);
      }

      expect(steps).toEqual(testCase.trace);
      expect(card.box).toBe(testCase.endBox);
      expect(isoDate(card.dueAt)).toBe(testCase.nextDue);
    });
  });
});
