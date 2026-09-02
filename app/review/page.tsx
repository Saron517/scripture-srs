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
 * Scheduling is the Leitner box system from src/scheduler/leitner.ts
 * (Build Lane Challenge Option B / B_Rules). Requires migration
 * 0003_box_scheduler.sql (adds cards.box / cards.review_count).
 *
 * To restore real auth: bring back the magic-link flow from git history and
 * drop the demo_* policies.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { checkAnswer, type CheckLang, type CheckResult } from '@/src/checker/index';
import { passageTextAttrs } from '@/src/i18n/direction';
import {
  DAY_MS,
  review,
  selectDueQueue,
  type Card as SchedulerCard,
  type Rating,
} from '@/src/scheduler/leitner';

/** The single account whose data the public demo shares. Demo mode only. */
const DEMO_USER_ID = '5f3fc43e-cdaa-4bf5-849e-b79834150da0';

/** localStorage key for the simulated-clock offset (whole days, may be 0). */
const CLOCK_KEY = 'review:nowOffsetDays';

/**
 * Map a passage's BCP-47 language to a checker language, or null when the
 * checker has no rules for it (the answer box is then hidden and the card is
 * revealed without a check).
 */
function toCheckLang(language: string): CheckLang | null {
  const primary = language.toLowerCase().split('-', 1)[0];
  if (primary === 'en' || primary === 'ar' || primary === 'hi' || primary === 'zh') {
    return primary as CheckLang;
  }
  return null;
}

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
  box: SchedulerCard['box'];
  review_count: number;
  due_at: string;
  last_reviewed_at: string | null;
  is_suspended: boolean;
  passages: PassageRow | null;
}

const CARD_COLUMNS =
  'id,user_id,passage_id,box,review_count,due_at,last_reviewed_at,is_suspended,' +
  'passages(id,reference,text,language,direction)';

const RATINGS: { key: Rating; label: string; hint: string }[] = [
  { key: 'again', label: 'Again', hint: 'no recall' },
  { key: 'hard', label: 'Hard', hint: 'barely' },
  { key: 'good', label: 'Good', hint: 'recalled' },
  { key: 'easy', label: 'Easy', hint: 'instant' },
];

function rowToCard(row: CardRow): SchedulerCard {
  return {
    box: row.box,
    dueAt: Date.parse(row.due_at),
    lastReviewedAt: row.last_reviewed_at ? Date.parse(row.last_reviewed_at) : null,
    reviewCount: row.review_count,
  };
}

/** "next due" label for a rating-button preview: whole days, per B_Rules. */
function formatInterval(days: number): string {
  if (days <= 0) return 'today';
  return `${days}d`;
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

  // Simulated clock: whole-day offset added to the real clock so the demo deck
  // can be pushed into the future without waiting real days. The scheduler is
  // still pure — this only changes the `now` the UI feeds it. Persisted so a
  // reload keeps the shifted date.
  const [nowOffsetDays, setNowOffsetDays] = useState(0);

  // Type-to-check recall: the reviewer's typed answer and the last check result.
  const [answer, setAnswer] = useState('');
  const [check, setCheck] = useState<CheckResult | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CLOCK_KEY);
      const n = raw == null ? 0 : Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n !== 0) setNowOffsetDays(n);
    } catch {
      /* localStorage unavailable — stay on the real clock */
    }
  }, []);

  /** The instant the UI treats as "now": real clock plus the demo offset. */
  const nowMs = useCallback(() => Date.now() + nowOffsetDays * DAY_MS, [nowOffsetDays]);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    // The scheduler never reads a clock — the UI decides what "now" is.
    const now = nowMs();
    const { data, error: qErr } = await supabase
      .from('cards')
      .select(CARD_COLUMNS)
      .eq('user_id', DEMO_USER_ID) // demo mode: one fixed account, no auth
      .eq('is_suspended', false)
      .lte('due_at', new Date(now).toISOString())
      .limit(200);

    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }

    // B_Rules daily cap: 20 cards, most overdue → lowest box → reference A-Z.
    const rows = (data ?? []) as unknown as CardRow[];
    const ordered = selectDueQueue(
      rows.map((row) => ({ row, card: rowToCard(row), reference: row.passages?.reference ?? '' })),
      now,
    ).map((entry) => entry.row);

    setQueue(ordered);
    setIndex(0);
    setReviewed(0);
    setRevealed(false);
    setAnswer('');
    setCheck(null);
  }, [supabase, nowMs]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  /**
   * Demo mode: reset the whole shared deck to box 0 and due now, straight from
   * the app — no SQL editor needed. Allowed by the demo_cards_update RLS policy.
   * First click arms; second click within a few seconds executes.
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
        box: 0,
        review_count: 0,
        due_at: new Date(nowMs()).toISOString(),
        last_reviewed_at: null,
      })
      .eq('user_id', DEMO_USER_ID);
    setResetting(false);
    if (rErr) {
      setError(rErr.message);
      return;
    }
    await loadQueue();
  }, [confirmReset, supabase, loadQueue, nowMs]);

  /** Move the simulated clock by `deltaDays`, or back to today when it is 0. */
  const shiftClock = useCallback((deltaDays: number) => {
    setNowOffsetDays((prev) => {
      const next = deltaDays === 0 ? 0 : prev + deltaDays;
      try {
        window.localStorage.setItem(CLOCK_KEY, String(next));
      } catch {
        /* localStorage unavailable — offset is session-only */
      }
      return next;
    });
  }, []);

  const current = queue[index];
  const checkLang = current?.passages ? toCheckLang(current.passages.language) : null;

  // Next-interval preview for each rating button.
  const previews = useMemo(() => {
    if (!current) return null;
    const card = rowToCard(current);
    const now = Date.now() + nowOffsetDays * DAY_MS;
    const byRating = {} as Record<Rating, string>;
    for (const { key } of RATINGS) {
      byRating[key] = formatInterval(review(card, key, now).log.intervalDays);
    }
    return byRating;
  }, [current, nowOffsetDays]);

  async function grade(rating: Rating) {
    if (!current || !current.passages) return;
    setSaving(true);
    setError(null);

    const now = nowMs(); // clock lives here, in the UI, then is passed in
    const { card: next, log } = review(rowToCard(current), rating, now);

    const { error: cardErr } = await supabase
      .from('cards')
      .update({
        box: next.box,
        review_count: next.reviewCount,
        due_at: new Date(next.dueAt).toISOString(),
        last_reviewed_at: new Date(now).toISOString(),
      })
      .eq('id', current.id);

    const { error: reviewErr } = await supabase.from('reviews').insert({
      user_id: DEMO_USER_ID, // demo mode: fixed account
      card_id: current.id,
      reviewed_at: new Date(log.reviewedAt).toISOString(),
      rating: log.rating,
      box_before: log.boxBefore,
      box_after: log.boxAfter,
      interval_days: log.intervalDays,
      due_before: new Date(log.dueBefore).toISOString(),
      due_after: new Date(log.dueAfter).toISOString(),
    });

    setSaving(false);
    if (cardErr || reviewErr) {
      setError((cardErr ?? reviewErr)?.message ?? 'Failed to save review');
      return;
    }
    setReviewed((n) => n + 1);
    setRevealed(false);
    setAnswer('');
    setCheck(null);
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
              {index + 1} / {queue.length} · box {current?.box ?? 0}
            </span>
          )}
          <button
            className="reset"
            onClick={() => void resetDemo()}
            disabled={resetting || loading}
            title="Set every demo card back to box 0 and due now"
          >
            {resetting
              ? 'Resetting…'
              : confirmReset
                ? 'Confirm reset?'
                : 'Reset demo deck'}
          </button>
        </div>
      </div>

      <div className="clock">
        <span className="muted">
          {nowOffsetDays === 0
            ? 'Clock: today (real time)'
            : `Clock: ${new Date(Date.now() + nowOffsetDays * DAY_MS).toLocaleDateString()} · +${nowOffsetDays}d`}
        </span>
        <span className="clock-btns">
          <button onClick={() => shiftClock(1)} disabled={loading || saving || resetting}>
            +1 day
          </button>
          <button onClick={() => shiftClock(7)} disabled={loading || saving || resetting}>
            +7 days
          </button>
          <button
            onClick={() => shiftClock(0)}
            disabled={loading || saving || resetting || nowOffsetDays === 0}
          >
            Today
          </button>
        </span>
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
              {check && (
                <div className={`verdict verdict-${check.verdict}`}>
                  <strong>{check.verdict}</strong>
                  <span>{check.summary}</span>
                </div>
              )}
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
              <p className="muted" style={{ marginBottom: 12 }}>
                {checkLang
                  ? 'Recite it from memory — type it below and check, or just reveal.'
                  : 'Recite it from memory, then reveal.'}
              </p>
              {checkLang && (
                <textarea
                  className="answer"
                  rows={4}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Type the passage from memory…"
                  {...passageTextAttrs(current.passages.language)}
                />
              )}
              <div className="controls" style={{ marginTop: 12 }}>
                {checkLang && (
                  <button
                    className="primary"
                    disabled={answer.trim().length === 0}
                    onClick={() => {
                      if (!current.passages || !checkLang) return;
                      setCheck(checkAnswer(answer, current.passages.text, checkLang));
                      setRevealed(true);
                    }}
                  >
                    Check
                  </button>
                )}
                <button
                  className={checkLang ? '' : 'primary'}
                  onClick={() => {
                    setCheck(null);
                    setRevealed(true);
                  }}
                >
                  {checkLang ? 'Reveal without checking' : 'Reveal'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}
