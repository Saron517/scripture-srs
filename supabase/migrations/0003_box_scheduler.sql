-- ─────────────────────────────────────────────────────────────────────────────
-- Switch the spaced-repetition model from SM-2 to the Leitner box system
-- mandated by the Build Lane Challenge Option B (B_Rules tab).
--
-- Cards now carry `box` (0..5) and `review_count` instead of the SM-2 ease /
-- interval / learning-step state. The reviews log records box transitions
-- instead of ease transitions.
--
-- Destructive: drops the SM-2 columns from `cards` and `reviews`. The shared
-- demo deck is reset to box 0, due now.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── cards ──────────────────────────────────────────────────────────────────

alter table public.cards
  add column if not exists box smallint not null default 0
    check (box between 0 and 5),
  add column if not exists review_count integer not null default 0
    check (review_count >= 0);

drop index if exists public.cards_due_idx;
drop index if exists public.cards_state_idx;

alter table public.cards
  drop column if exists state,
  drop column if exists interval_days,
  drop column if exists ease_factor,
  drop column if exists reps,
  drop column if exists lapses,
  drop column if exists learning_step_index;

-- Queue order per B_Rules is (most overdue, then lowest box, then reference).
-- reference lives on `passages`, so the final A-Z tie-break is applied in the
-- app; this index covers the first two keys.
create index cards_due_idx on public.cards (user_id, is_suspended, due_at, box);

-- ── reviews (append-only log) ─────────────────────────────────────────────

alter table public.reviews
  drop column if exists state_before,
  drop column if exists state_after,
  drop column if exists interval_days_before,
  drop column if exists interval_days_after,
  drop column if exists ease_before,
  drop column if exists ease_after,
  drop column if exists elapsed_days;

alter table public.reviews
  add column if not exists box_before   smallint check (box_before between 0 and 5),
  add column if not exists box_after    smallint check (box_after between 0 and 5),
  add column if not exists interval_days double precision,
  add column if not exists due_before   timestamptz,
  add column if not exists due_after    timestamptz;

-- ── due_cards helper: tie-break on box after due_at ───────────────────────

create or replace function public.due_cards(p_now timestamptz, p_limit int default 20)
returns setof public.cards
language sql
stable
security invoker
as $$
  select *
  from public.cards
  where user_id = auth.uid()
    and is_suspended = false
    and due_at <= p_now
  order by due_at asc, box asc
  limit greatest(coalesce(p_limit, 20), 0);
$$;

-- ── reset the shared demo deck to fresh box 0 ────────────────────────────

update public.cards
   set box = 0, review_count = 0, due_at = now(), last_reviewed_at = null
 where user_id = '5f3fc43e-cdaa-4bf5-849e-b79834150da0';

commit;

-- verify (optional): every demo card at box 0, due now
--   select box, review_count, due_at from public.cards
--    where user_id = '5f3fc43e-cdaa-4bf5-849e-b79834150da0' order by box;
