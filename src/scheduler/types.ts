/**
 * Types and defaults for the spaced-repetition scheduler.
 *
 * The scheduler is an SM-2 variant (SuperMemo 2 / Anki-style) with explicit
 * learning and relearning steps. It is a pure state machine: every function is a
 * pure function of its arguments, time is always passed in as `now` (epoch
 * milliseconds), and nothing here ever reads the system clock.
 */

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export type CardStateName = 'new' | 'learning' | 'review' | 'relearning';

/** Serializable spaced-repetition state for a single passage. */
export interface Card {
  /** Where the card sits in the SM-2 state machine. */
  state: CardStateName;
  /** When the card next becomes due, epoch milliseconds. */
  dueAt: number;
  /** Scheduled interval used by the review queue, in days (0 while new/learning). */
  intervalDays: number;
  /** SM-2 ease factor; never falls below `SchedulerConfig.minEaseFactor`. */
  easeFactor: number;
  /** Count of successful graduations / review passes. */
  reps: number;
  /** Count of `again` ratings received while in the `review` state. */
  lapses: number;
  /** Position within the learning / relearning step ladder. */
  learningStepIndex: number;
  /** When the card was last reviewed, epoch milliseconds, or null if never. */
  lastReviewedAt: number | null;
}

export interface SchedulerConfig {
  /** Minute offsets for each learning step before a new card graduates. */
  learningStepsMinutes: number[];
  /** Minute offsets for each relearning step after a lapse. */
  relearningStepsMinutes: number[];
  /** Interval (days) a card graduates to from learning on `good`. */
  graduatingIntervalDays: number;
  /** Interval (days) a card graduates to from learning on `easy`. */
  easyIntervalDays: number;
  /** Ease factor assigned to a brand-new card. */
  startingEaseFactor: number;
  /** Hard floor for the ease factor. */
  minEaseFactor: number;
  /** Extra multiplier applied on top of ease when a review is rated `easy`. */
  easyBonus: number;
  /** Interval multiplier when a review is rated `hard`. */
  hardIntervalMultiplier: number;
  /** Fraction of the previous interval retained on a lapse (0 = start over). */
  lapseIntervalMultiplier: number;
  /** Smallest interval, in days, the review queue will ever schedule. */
  minReviewIntervalDays: number;
  /** Largest interval, in days, the review queue will ever schedule. */
  maximumIntervalDays: number;
  /** Global multiplier on every computed review interval. */
  intervalModifier: number;
}

export const DEFAULT_CONFIG: SchedulerConfig = {
  learningStepsMinutes: [1, 10],
  relearningStepsMinutes: [10],
  graduatingIntervalDays: 1,
  easyIntervalDays: 4,
  startingEaseFactor: 2.5,
  minEaseFactor: 1.3,
  easyBonus: 1.3,
  hardIntervalMultiplier: 1.2,
  lapseIntervalMultiplier: 0,
  minReviewIntervalDays: 1,
  maximumIntervalDays: 365 * 10,
  intervalModifier: 1,
};

export const DAY_MS = 86_400_000;
export const MINUTE_MS = 60_000;

/** Immutable record describing one review; mirrors the `reviews` DB table. */
export interface ReviewLog {
  reviewedAt: number;
  rating: Rating;
  stateBefore: CardStateName;
  stateAfter: CardStateName;
  intervalDaysBefore: number;
  intervalDaysAfter: number;
  easeBefore: number;
  easeAfter: number;
  /** Days between the previous review and this one, or null on the first review. */
  elapsedDays: number | null;
}

export interface ReviewOutput {
  /** The next card state. The input card is never mutated. */
  card: Card;
  /** What happened, ready to persist as a row in `reviews`. */
  log: ReviewLog;
}
