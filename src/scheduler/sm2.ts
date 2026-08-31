/**
 * Pure SM-2 spaced-repetition scheduler.
 *
 * Design rules enforced here:
 *   - Every function is pure. The input `Card` is never mutated; a new object is
 *     always returned.
 *   - Time enters only through the `now` parameter (epoch milliseconds). Nothing
 *     in this module calls `Date.now()`, `new Date()`, `performance.now()`, or
 *     any other ambient clock. Given the same arguments it always returns the
 *     same result, whenever it runs.
 */

import {
  type Card,
  type CardStateName,
  DAY_MS,
  DEFAULT_CONFIG,
  MINUTE_MS,
  type Rating,
  type ReviewOutput,
  type SchedulerConfig,
} from './types.js';

/** Create the initial state for a passage that has never been reviewed. */
export function createCard(now: number): Card {
  assertFiniteNow(now);
  return {
    state: 'new',
    dueAt: now,
    intervalDays: 0,
    easeFactor: DEFAULT_CONFIG.startingEaseFactor,
    reps: 0,
    lapses: 0,
    learningStepIndex: 0,
    lastReviewedAt: null,
  };
}

/** True when the card is due for review at the given instant. */
export function isDue(card: Card, now: number): boolean {
  assertFiniteNow(now);
  return card.dueAt <= now;
}

/** Merge caller overrides onto the default config. */
export function resolveConfig(overrides?: Partial<SchedulerConfig>): SchedulerConfig {
  return { ...DEFAULT_CONFIG, ...(overrides ?? {}) };
}

/**
 * Apply a rating to a card at instant `now` and return the next state plus a log
 * entry ready to persist.
 */
export function review(
  card: Card,
  rating: Rating,
  now: number,
  overrides?: Partial<SchedulerConfig>,
): ReviewOutput {
  assertFiniteNow(now);
  const cfg = resolveConfig(overrides);
  const before: Card = { ...card };

  let next: Card;
  switch (card.state) {
    case 'new':
    case 'learning':
      next = advanceLearning(card, rating, now, cfg, 'learning');
      break;
    case 'relearning':
      next = advanceLearning(card, rating, now, cfg, 'relearning');
      break;
    case 'review':
      next = advanceReview(card, rating, now, cfg);
      break;
    default: {
      const unreachable: never = card.state;
      throw new Error(`scheduler: unknown card state ${String(unreachable)}`);
    }
  }

  next = { ...next, lastReviewedAt: now };

  return {
    card: next,
    log: {
      reviewedAt: now,
      rating,
      stateBefore: before.state,
      stateAfter: next.state,
      intervalDaysBefore: before.intervalDays,
      intervalDaysAfter: next.intervalDays,
      easeBefore: before.easeFactor,
      easeAfter: next.easeFactor,
      elapsedDays:
        before.lastReviewedAt === null ? null : (now - before.lastReviewedAt) / DAY_MS,
    },
  };
}

// ── internals ──────────────────────────────────────────────────────────────

function assertFiniteNow(now: number): void {
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new TypeError('scheduler: `now` must be a finite epoch-millisecond number');
  }
}

function clampReviewInterval(days: number, cfg: SchedulerConfig): number {
  const bounded = Math.min(
    cfg.maximumIntervalDays,
    Math.max(cfg.minReviewIntervalDays, days),
  );
  return Math.round(bounded);
}

function stepAt(steps: number[], index: number): number {
  if (steps.length === 0) return 10;
  const clamped = Math.min(Math.max(index, 0), steps.length - 1);
  return steps[clamped] as number;
}

function advanceLearning(
  card: Card,
  rating: Rating,
  now: number,
  cfg: SchedulerConfig,
  phase: Extract<CardStateName, 'learning' | 'relearning'>,
): Card {
  const steps =
    phase === 'learning' ? cfg.learningStepsMinutes : cfg.relearningStepsMinutes;
  const stepCount = Math.max(steps.length, 1);
  const base: Card = { ...card, state: phase };

  if (rating === 'again') {
    return { ...base, learningStepIndex: 0, dueAt: now + stepAt(steps, 0) * MINUTE_MS };
  }

  if (rating === 'easy') {
    return graduate(base, now, cfg, cfg.easyIntervalDays);
  }

  if (rating === 'hard') {
    const index = Math.min(card.learningStepIndex, stepCount - 1);
    return { ...base, learningStepIndex: index, dueAt: now + stepAt(steps, index) * MINUTE_MS };
  }

  // rating === 'good' → advance one step, graduate once past the last step
  const nextIndex = card.learningStepIndex + 1;
  if (nextIndex >= stepCount) {
    const graduatingInterval =
      phase === 'learning'
        ? cfg.graduatingIntervalDays
        : Math.max(
            cfg.minReviewIntervalDays,
            Math.round(card.intervalDays * cfg.lapseIntervalMultiplier) ||
              cfg.minReviewIntervalDays,
          );
    return graduate(base, now, cfg, graduatingInterval);
  }
  return {
    ...base,
    learningStepIndex: nextIndex,
    dueAt: now + stepAt(steps, nextIndex) * MINUTE_MS,
  };
}

function graduate(card: Card, now: number, cfg: SchedulerConfig, intervalDays: number): Card {
  const interval = clampReviewInterval(intervalDays, cfg);
  return {
    ...card,
    state: 'review',
    intervalDays: interval,
    learningStepIndex: 0,
    reps: card.reps + 1,
    dueAt: now + interval * DAY_MS,
  };
}

function advanceReview(card: Card, rating: Rating, now: number, cfg: SchedulerConfig): Card {
  if (rating === 'again') {
    return {
      ...card,
      state: 'relearning',
      easeFactor: Math.max(cfg.minEaseFactor, card.easeFactor - 0.2),
      intervalDays: clampReviewInterval(
        card.intervalDays * cfg.lapseIntervalMultiplier,
        cfg,
      ),
      lapses: card.lapses + 1,
      learningStepIndex: 0,
      dueAt: now + stepAt(cfg.relearningStepsMinutes, 0) * MINUTE_MS,
    };
  }

  const prev = card.intervalDays;
  let easeFactor = card.easeFactor;
  let rawInterval: number;

  if (rating === 'hard') {
    easeFactor = Math.max(cfg.minEaseFactor, easeFactor - 0.15);
    rawInterval = prev * cfg.hardIntervalMultiplier * cfg.intervalModifier;
  } else if (rating === 'good') {
    rawInterval = prev * easeFactor * cfg.intervalModifier;
  } else {
    // rating === 'easy'
    easeFactor = easeFactor + 0.15;
    rawInterval = prev * easeFactor * cfg.easyBonus * cfg.intervalModifier;
  }

  let intervalDays = clampReviewInterval(rawInterval, cfg);
  if ((rating === 'good' || rating === 'easy') && intervalDays <= prev) {
    // a successful review must always push the interval out
    intervalDays = clampReviewInterval(prev + 1, cfg);
  }

  return {
    ...card,
    state: 'review',
    easeFactor,
    intervalDays,
    reps: card.reps + 1,
    dueAt: now + intervalDays * DAY_MS,
  };
}
