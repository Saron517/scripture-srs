/**
 * Leitner box scheduler — the algorithm mandated by the Build Lane Challenge
 * Option B `B_Rules` tab (authoritative).
 *
 *   Boxes and intervals
 *     Box 0  0 days — due again the same day
 *     Box 1  1 day
 *     Box 2  3 days
 *     Box 3  7 days
 *     Box 4  21 days
 *     Box 5  60 days — maximum box
 *
 *   Grades
 *     again  Box resets to 0.
 *     hard   Box unchanged. Interval is 60% of the box interval, rounded down,
 *            minimum 1 day.
 *     good   Box increases by 1, capped at 5.
 *     easy   Box increases by 2, capped at 5.
 *
 *   Scheduling
 *     New card       Starts at box 0, due immediately.
 *     Next due date  The review date plus the interval produced by that grade.
 *     Daily cap      20 cards. Most overdue first, then lowest box, then
 *                    reference A-Z.
 *
 * Same engineering rules as the rest of src/scheduler: every function is pure,
 * the input `Card` is never mutated, and time enters only through the `now`
 * argument (epoch milliseconds) — nothing here reads an ambient clock.
 */

export type Rating = 'again' | 'hard' | 'good' | 'easy';

/** Leitner box. 0 = new or just-failed, 5 = mastered (the maximum). */
export type Box = 0 | 1 | 2 | 3 | 4 | 5;

/** Serializable state for one card. */
export interface Card {
  /** Current Leitner box. */
  box: Box;
  /** When the card is next due, epoch milliseconds. */
  dueAt: number;
  /** When the card was last reviewed, epoch milliseconds, or null if never. */
  lastReviewedAt: number | null;
  /** How many reviews have been applied to this card. */
  reviewCount: number;
}

export interface SchedulerConfig {
  /** Whole-day interval for each box; index === box number. */
  boxIntervalDays: readonly [number, number, number, number, number, number];
  /** Fraction of the box interval a `hard` grade keeps. */
  hardFactor: number;
  /** Floor, in days, for a `hard` interval. */
  hardMinDays: number;
  /** Highest reachable box. */
  maxBox: Box;
  /** Cards surfaced per day by `selectDueQueue`. */
  dailyCap: number;
}

export const DEFAULT_CONFIG: SchedulerConfig = {
  boxIntervalDays: [0, 1, 3, 7, 21, 60],
  hardFactor: 0.6,
  hardMinDays: 1,
  maxBox: 5,
  dailyCap: 20,
};

export const DAY_MS = 86_400_000;

/** Immutable record of one review; mirrors what a `reviews` row should store. */
export interface ReviewLog {
  reviewedAt: number;
  rating: Rating;
  boxBefore: Box;
  boxAfter: Box;
  /** Days added to `reviewedAt` to produce the next due date. */
  intervalDays: number;
  dueBefore: number;
  dueAfter: number;
}

export interface ReviewOutput {
  /** The next card state. The input card is never mutated. */
  card: Card;
  /** What happened, ready to persist. */
  log: ReviewLog;
}

// ── public API ─────────────────────────────────────────────────────────────

/** Initial state for a card that has never been reviewed: box 0, due now. */
export function createCard(now: number): Card {
  assertFiniteNow(now);
  return { box: 0, dueAt: now, lastReviewedAt: null, reviewCount: 0 };
}

/** True when the card is due at the given instant. */
export function isDue(card: Card, now: number): boolean {
  assertFiniteNow(now);
  return card.dueAt <= now;
}

/** Merge caller overrides onto the default config. */
export function resolveConfig(overrides?: Partial<SchedulerConfig>): SchedulerConfig {
  return { ...DEFAULT_CONFIG, ...(overrides ?? {}) };
}

/**
 * Apply a grade to a card at instant `now`. Returns the next card state and a
 * log entry. Per `B_Rules`, the next due date is `now` plus the interval the
 * grade produces — so a card reviewed late is rescheduled from the review
 * moment, not from its old due date.
 */
export function review(
  card: Card,
  rating: Rating,
  now: number,
  overrides?: Partial<SchedulerConfig>,
): ReviewOutput {
  assertFiniteNow(now);
  const cfg = resolveConfig(overrides);
  const boxBefore = clampBox(card.box, cfg);
  const boxAfter = nextBox(boxBefore, rating, cfg);
  const intervalDays = gradeIntervalDays(boxBefore, rating, cfg);
  const dueAfter = now + intervalDays * DAY_MS;

  return {
    card: {
      box: boxAfter,
      dueAt: dueAfter,
      lastReviewedAt: now,
      reviewCount: card.reviewCount + 1,
    },
    log: {
      reviewedAt: now,
      rating,
      boxBefore,
      boxAfter,
      intervalDays,
      dueBefore: card.dueAt,
      dueAfter,
    },
  };
}

/**
 * The day's review queue: due cards only, ordered "most overdue first, then
 * lowest box, then reference A-Z", capped at `dailyCap`. Each entry pairs a
 * card with its passage reference (the tie-breaker lives on the passage, not
 * the card).
 */
export function selectDueQueue<T extends { card: Card; reference: string }>(
  entries: readonly T[],
  now: number,
  overrides?: Partial<SchedulerConfig>,
): T[] {
  assertFiniteNow(now);
  const cfg = resolveConfig(overrides);
  return [...entries]
    .filter((entry) => entry.card.dueAt <= now)
    .sort(
      (a, b) =>
        a.card.dueAt - b.card.dueAt || // most overdue first
        a.card.box - b.card.box || // then lowest box
        a.reference.localeCompare(b.reference, 'en'), // then reference A-Z
    )
    .slice(0, Math.max(0, cfg.dailyCap));
}

// ── internals ──────────────────────────────────────────────────────────────

function assertFiniteNow(now: number): void {
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new TypeError('scheduler: `now` must be a finite epoch-millisecond number');
  }
}

function clampBox(box: number, cfg: SchedulerConfig): Box {
  return Math.min(Math.max(Math.trunc(box), 0), cfg.maxBox) as Box;
}

/** Box the card lands in after `rating` (before the interval is computed). */
function nextBox(box: Box, rating: Rating, cfg: SchedulerConfig): Box {
  switch (rating) {
    case 'again':
      return 0;
    case 'hard':
      return box;
    case 'good':
      return clampBox(box + 1, cfg);
    case 'easy':
      return clampBox(box + 2, cfg);
    default: {
      const unreachable: never = rating;
      throw new Error(`scheduler: unknown grade ${String(unreachable)}`);
    }
  }
}

/** Whole-day interval a `rating` produces from the current `box`. */
function gradeIntervalDays(box: Box, rating: Rating, cfg: SchedulerConfig): number {
  if (rating === 'hard') {
    // 60% of the (unchanged) box interval, floored, min 1 day.
    return Math.max(cfg.hardMinDays, Math.floor(cfg.boxIntervalDays[box] * cfg.hardFactor));
  }
  return cfg.boxIntervalDays[nextBox(box, rating, cfg)];
}
