'use client';

/**
 * /review — DEMO MODE (not multi-user).
 *
 * Sign-in is disabled so a reviewer can test the live deployment with zero
 * friction. Every visitor reads and writes the SAME fixed demo account's cards:
 *
 *     DEMO_USER_ID = 5f3fc43e-cdaa-4bf5-849e-b79834150da0
 *
 * This only works because supabase/migrations/0002_demo_mode.sql adds RLS
 * policies that expose exactly that user's rows to the anonymous role. All other
 * users' rows stay private. There is no isolation between demo visitors — they
 * share one deck.
 *
 * To restore real auth: bring back the magic-link flow from git history
 * (commit before this change) and drop the demo_* policies.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { passageTextAttrs } from '@/src/i18n/direction';
import { review, type Card as SchedulerCard, type Rating } from '@/src/scheduler';

/** The single account whose data the public demo shares. Demo mode only. */
const DEMO_USER_ID = '5f3fc43e-cdaa-4bf5-849e-b79834150da0';

// ── row shapes (snake_case, straight from Postgres) ─────────────────────────

interface PassageRow {
  id: string;
  reference: string;
  text: string;
  language: string;
  direction: 'ltr' | 'rtl';
}

interface CardRow {
  id: string;
  user_id: string;
  passage_id: string;
  state: SchedulerCard['state'];
  due_at: string;
  interval_days: number;
  ease_factor: number;
  reps: number;
  lapses: number;
  learning_step_index: number;
  last_reviewed_at: string | null;
  is_suspended: boolean;
  passages: PassageRow | null;
}

const CARD_COLUMNS =
  'id,user_id,passage_id,state,due_at,interval_days,ease_factor,reps,lapses,' +
  'learning_step_index,last_reviewed_at,is_suspended,' +
  'passages(id,reference,text,language,direction)';

const RATINGS: { key: Rating; label: string; hint: string }[] = [
  { key: 'again', label: 'Again', hint: 'no recall' },
  { key: 'hard', label: 'Hard', hint: 'barely' },
  { key: 'good', label: 'Good', hint: 'recalled' },
  { key: 'easy', label: 'Easy', hint: 'instant' },
];

function rowToCard(row: CardRow): SchedulerCard {
  return {
    state: row.state,
    dueAt: Date.parse(row.due_at),
    intervalDays: row.interval_days,
    easeFactor: row.ease_factor,
    reps: row.reps,
    lapses: row.lapses,
    learningStepIndex: row.learning_step_index,
    lastReviewedAt: row.last_reviewed_at ? Date.parse(row.last_reviewed_at) : null,
  };
}

/** Short "next due" label for a rating-button preview, e.g. "10m" / "3h" / "20d". */
function formatNext(card: SchedulerCard, now: number): string {
  const mins = Math.max(1, Math.round((card.dueAt - now) / 60_000));
  if (mins < 90) return `${mins}m`;
  if (mins < 60 * 36) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1_440)}d`;
}

// ── page ───────────────────────────────────────────────────────────────────

export default function ReviewPage() {
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<CardRow[]>([]);
  const [index, setIndex] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    // The scheduler never reads a clock — the UI decides what "now" is.
    const nowIso = new Date().toISOString();
    const { data, error: qErr } = await supabase
      .from('cards')
      .select(CARD_COLUMNS)
      .eq('user_id', DEMO_USER_ID) // demo mode: one fixed account, no auth
      .eq('is_suspended', false)
      .lte('due_at', nowIso)
      .order('due_at', { ascending: true })
      .limit(50);

    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    setQueue((data ?? []) as unknown as CardRow[]);
    setIndex(0);
    setReviewed(0);
    setRevealed(false);
  }, [supabase]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  /**
   * Demo mode: reset the whole shared deck to brand-new and due now, straight
   * from the app — no SQL editor needed. Runs the same UPDATE as the reset
   * snippet in supabase/migrations/0002_demo_mode.sql, allowed by the
   * demo_cards_update RLS policy. First click arms; second click within a few
   * seconds executes.
   */
  const resetDemo = useCallback(async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      window.setTimeout(() => setConfirmReset(false), 3000);
      return;
    }
    setConfirmReset(false);
    setResetting(true);
    setError(null);
    const { error: rErr } = await supabase
      .from('cards')
      .update({
        state: 'new',
        due_at: new Date().toISOString(),
        interval_days: 0,
        ease_factor: 2.5,
        reps: 0,
        lapses: 0,
        learning_step_index: 0,
        last_reviewed_at: null,
      })
      .eq('user_id', DEMO_USER_ID);
    setResetting(false);
    if (rErr) {
      setError(rErr.message);
      return;
    }
    await loadQueue();
  }, [confirmReset, supabase, loadQueue]);

  const current = queue[index];

  // Interval preview for each rating button.
  const previews = useMemo(() => {
    if (!current) return null;
    const card = rowToCard(current);
    const now = Date.now();
    const byRating = {} as Record<Rating, string>;
    for (const { key } of RATINGS) {
      byRating[key] = formatNext(review(card, key, now).card, now);
    }
    return byRating;
  }, [current]);

  async function grade(rating: Rating) {
    if (!current || !current.passages) return;
    setSaving(true);
    setError(null);

    const now = Date.now(); // clock lives here, in the UI, then is passed in
    const { card: next, log } = review(rowToCard(current), rating, now);

    const { error: cardErr } = await supabase
      .from('cards')
      .update({
        state: next.state,
        due_at: new Date(next.dueAt).toISOString(),
        interval_days: next.intervalDays,
        ease_factor: next.easeFactor,
        reps: next.reps,
        lapses: next.lapses,
        learning_step_index: next.learningStepIndex,
        last_reviewed_at: new Date(now).toISOString(),
      })
      .eq('id', current.id);

    const { error: reviewErr } = await supabase.from('reviews').insert({
      user_id: DEMO_USER_ID, // demo mode: fixed account
      card_id: current.id,
      reviewed_at: new Date(log.reviewedAt).toISOString(),
      rating: log.rating,
      state_before: log.stateBefore,
      state_after: log.stateAfter,
      interval_days_before: log.intervalDaysBefore,
      interval_days_after: log.intervalDaysAfter,
      ease_before: log.easeBefore,
      ease_after: log.easeAfter,
      elapsed_days: log.elapsedDays,
    });

    setSaving(false);
    if (cardErr || reviewErr) {
      setError((cardErr ?? reviewErr)?.message ?? 'Failed to save review');
      return;
    }
    setReviewed((n) => n + 1);
    setRevealed(false);
    setIndex((i) => i + 1);
  }

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <main className="wrap">
      <div className="top">
        <div>
          <h1>Scripture Review</h1>
          <span className="muted" style={{ display: 'block', marginTop: 2 }}>
            Demo mode — shared data, no sign-in
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {queue.length > 0 && index < queue.length && (
            <span className="muted">
              {index + 1} / {queue.length}
            </span>
          )}
          <button
            className="reset"
            onClick={() => void resetDemo()}
            disabled={resetting || loading}
            title="Set every demo card back to new and due now"
          >
            {resetting
              ? 'Resetting…'
              : confirmReset
                ? 'Confirm reset?'
                : 'Reset demo deck'}
          </button>
        </div>
      </div>

      {error && <div className="err">{error}</div>}

      {loading && <p className="muted">Loading…</p>}

      {!loading && queue.length === 0 && (
        <div className="card">
          <p style={{ marginTop: 0 }}>Nothing due right now.</p>
          <button onClick={() => void loadQueue()}>Refresh</button>
        </div>
      )}

      {!loading && queue.length > 0 && index >= queue.length && (
        <div className="card">
          <p style={{ marginTop: 0 }}>Session complete — {reviewed} reviewed.</p>
          <button className="primary" onClick={() => void loadQueue()}>
            Check for more
          </button>
        </div>
      )}

      {!loading && current && (
        <div className="card">
          <div className="ref">{current.passages?.reference ?? '—'}</div>

          {!current.passages ? (
            <p className="err" style={{ margin: 0 }}>
              This card&apos;s passage is missing.
            </p>
          ) : revealed ? (
            <>
              <p className="passage" {...passageTextAttrs(current.passages.language)}>
                {current.passages.text}
              </p>
              <div className="controls">
                {RATINGS.map((r) => (
                  <button
                    key={r.key}
                    className={r.key === 'good' ? 'primary rating' : 'rating'}
                    disabled={saving}
                    onClick={() => void grade(r.key)}
                  >
                    {r.label}
                    <small>
                      {r.hint}
                      {previews ? ` · ${previews[r.key]}` : ''}
                    </small>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="muted" style={{ marginBottom: 24 }}>
                Recite it from memory, then reveal.
              </p>
              <button className="primary" onClick={() => setRevealed(true)}>
                Reveal
              </button>
            </>
          )}
        </div>
      )}
    </main>
  );
}
