/**
 * Deterministic 30-day review simulation harness.
 *
 * Not a test file itself (no `.test.ts` suffix) — it is imported by
 * scheduler.simulation.test.ts. Given a seed it plays a fixed cast of passages
 * through N days of study sessions and records every state transition, using a
 * seeded PRNG instead of `Math.random()` and a fixed epoch anchor instead of the
 * system clock. Running it twice with the same seed yields byte-identical
 * history.
 */

import { createCard, isDue, review } from '../src/scheduler/sm2.js';
import { type Card, DAY_MS, DEFAULT_CONFIG, type Rating } from '../src/scheduler/types.js';
import { mulberry32 } from '../src/scheduler/prng.js';

/** Fixed anchor: 2026-01-01 08:00:00 UTC. Chosen constant, not `Date.now()`. */
export const SIM_T0 = Date.UTC(2026, 0, 1, 8, 0, 0);

export interface SimPassage {
  id: string;
  /** Includes Arabic (RTL) and Hindi/Mandarin (LTR) so language travels with the card. */
  language: string;
  /** How this passage's learner behaves, so outcomes are meaningful to assert. */
  profile: 'diligent' | 'realistic' | 'leech';
}

export const SIM_PASSAGES: readonly SimPassage[] = [
  { id: 'jhn-3-16-en', language: 'en', profile: 'diligent' },
  { id: 'psa-23-1-en', language: 'en', profile: 'realistic' },
  { id: 'jhn-3-16-zh', language: 'zh-Hans', profile: 'realistic' },
  { id: 'jhn-3-16-ar', language: 'ar', profile: 'realistic' },
  { id: 'jhn-3-16-hi', language: 'hi', profile: 'realistic' },
  { id: 'rom-3-23-ar', language: 'ar', profile: 'leech' },
];

export interface SimStep {
  day: number;
  passageId: string;
  language: string;
  now: number;
  rating: Rating;
  before: Card;
  after: Card;
  logReviewedAt: number;
}

export interface SimResult {
  history: SimStep[];
  finalCards: Record<string, Card>;
  reviewCount: number;
}

function pickRating(passage: SimPassage, card: Card, rng: () => number): Rating {
  if (passage.profile === 'diligent') {
    // Studies daily, always recalls it.
    return 'good';
  }
  if (passage.profile === 'leech') {
    // Fails every real review; only ever scrapes back through relearning.
    return card.state === 'review' ? 'again' : 'good';
  }
  // 'realistic': mostly recalls, sometimes stumbles.
  const r = rng();
  if (r < 0.08) return 'again';
  if (r < 0.22) return 'hard';
  if (r < 0.9) return 'good';
  return 'easy';
}

/** Play `days` of daily study sessions and return the full transition history. */
export function runSimulation(seed: number, days = 30): SimResult {
  const rng = mulberry32(seed);
  const cards = new Map<string, Card>();
  for (const p of SIM_PASSAGES) cards.set(p.id, createCard(SIM_T0));

  const history: SimStep[] = [];

  for (let day = 0; day < days; day++) {
    const now = SIM_T0 + day * DAY_MS;

    for (const passage of SIM_PASSAGES) {
      let card = cards.get(passage.id) as Card;

      // One study session may touch a card more than once (e.g. short learning
      // steps that come due again the same session). Guard against runaway loops.
      let guard = 0;
      while (isDue(card, now) && guard < 20) {
        guard += 1;
        const rating = pickRating(passage, card, rng);
        const before = card;
        const out = review(card, rating, now, DEFAULT_CONFIG);
        card = out.card;
        history.push({
          day,
          passageId: passage.id,
          language: passage.language,
          now,
          rating,
          before,
          after: card,
          logReviewedAt: out.log.reviewedAt,
        });
      }

      cards.set(passage.id, card);
    }
  }

  return {
    history,
    finalCards: Object.fromEntries(cards),
    reviewCount: history.length,
  };
}
