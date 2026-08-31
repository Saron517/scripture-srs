'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { createClient } from '@/lib/supabase/client';
import { passageTextAttrs } from '@/src/i18n/direction';
import { review, type Card as SchedulerCard, type Rating } from '@/src/scheduler';

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

  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [queue, setQueue] = useState<CardRow[]>([]);
  const [index, setIndex] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [magicSent, setMagicSent] = useState(false);

  // Auth bootstrap + keep in sync with magic-link return.
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUserId(data.session?.user.id ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const loadQueue = useCallback(async () => {
    setError(null);
    // The scheduler never reads a clock — the UI decides what "now" is.
    const nowIso = new Date().toISOString();
    const { data, error: qErr } = await supabase
      .from('cards')
      .select(CARD_COLUMNS)
      .eq('is_suspended', false)
      .lte('due_at', nowIso)
      .order('due_at', { ascending: true })
      .limit(50);

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
    if (ready && userId) void loadQueue();
  }, [ready, userId, loadQueue]);

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
    if (!current || !userId || !current.passages) return;
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
      user_id: userId,
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

  async function sendMagicLink(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error: authErr } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href },
    });
    if (authErr) setError(authErr.message);
    else setMagicSent(true);
  }

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <main className="wrap">
      <div className="top">
        <h1>Scripture Review</h1>
        {userId && queue.length > 0 && index < queue.length && (
          <span className="muted">
            {index + 1} / {queue.length}
          </span>
        )}
      </div>

      {error && <div className="err">{error}</div>}

      {!ready && <p className="muted">Loading…</p>}

      {ready && !userId && (
        <div className="card">
          <p style={{ marginTop: 0 }}>Sign in to start a review session.</p>
          {magicSent ? (
            <p className="muted">Check your email for a sign-in link.</p>
          ) : (
            <form className="auth" onSubmit={sendMagicLink}>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="submit" className="primary">
                Send magic link
              </button>
            </form>
          )}
        </div>
      )}

      {ready && userId && queue.length === 0 && (
        <div className="card">
          <p style={{ marginTop: 0 }}>Nothing due right now.</p>
          <button onClick={() => void loadQueue()}>Refresh</button>
        </div>
      )}

      {ready && userId && queue.length > 0 && index >= queue.length && (
        <div className="card">
          <p style={{ marginTop: 0 }}>Session complete — {reviewed} reviewed.</p>
          <button className="primary" onClick={() => void loadQueue()}>
            Check for more
          </button>
        </div>
      )}

      {ready && userId && current && (
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
