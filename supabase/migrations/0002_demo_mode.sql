-- ─────────────────────────────────────────────────────────────────────────────
-- DEMO MODE — NOT MULTI-USER.
--
-- The /review screen ships with sign-in disabled so a reviewer can test the
-- live deployment with zero friction. Every anonymous visitor reads and writes
-- the SAME fixed demo account's data:
--
--     DEMO_USER_ID = 5f3fc43e-cdaa-4bf5-849e-b79834150da0
--
-- This migration adds permissive RLS policies that expose exactly that one
-- user's rows to the `anon` role. The auth.uid()-scoped policies from
-- 0001_init.sql are untouched, and RLS policies are OR-ed, so every OTHER
-- user's rows stay private. There is no isolation between demo visitors — they
-- share one deck; concurrent reviewers will step on each other's scheduling
-- state. That is the accepted trade-off for a frictionless demo.
--
-- To undo: drop the four demo_* policies at the bottom of this file.
--
-- To reset the demo deck (all cards back to brand-new, due now):
--     update public.cards
--        set state = 'new', due_at = now(), interval_days = 0, ease_factor = 2.5,
--            reps = 0, lapses = 0, learning_step_index = 0, last_reviewed_at = null
--      where user_id = '5f3fc43e-cdaa-4bf5-849e-b79834150da0';
-- ─────────────────────────────────────────────────────────────────────────────

-- Table-level access for the anonymous role (RLS below still gates which rows).
-- Supabase usually grants these by default; stated explicitly so the demo does
-- not depend on that.
grant select         on public.passages to anon, authenticated;
grant select, update on public.cards    to anon, authenticated;
grant insert         on public.reviews  to anon, authenticated;

-- passages: anyone may READ the demo user's verses.
create policy demo_passages_read on public.passages
  for select
  to anon, authenticated
  using (user_id = '5f3fc43e-cdaa-4bf5-849e-b79834150da0'::uuid);

-- cards: anyone may READ the demo user's spaced-repetition state.
create policy demo_cards_read on public.cards
  for select
  to anon, authenticated
  using (user_id = '5f3fc43e-cdaa-4bf5-849e-b79834150da0'::uuid);

-- cards: anyone may UPDATE the demo user's spaced-repetition state
-- (the review screen writes the new interval / ease / due date back here).
create policy demo_cards_update on public.cards
  for update
  to anon, authenticated
  using (user_id = '5f3fc43e-cdaa-4bf5-849e-b79834150da0'::uuid)
  with check (user_id = '5f3fc43e-cdaa-4bf5-849e-b79834150da0'::uuid);

-- reviews: anyone may APPEND a review-log row for the demo user.
create policy demo_reviews_insert on public.reviews
  for insert
  to anon, authenticated
  with check (user_id = '5f3fc43e-cdaa-4bf5-849e-b79834150da0'::uuid);
