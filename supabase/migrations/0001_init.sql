-- Scripture memorization tool — initial schema.
--
-- Three tables:
--   passages  verse text supplied by the operator (imported from JSON), one row
--             per verse/passage per user, tagged with its language and a derived
--             script direction for RTL rendering.
--   cards     spaced-repetition state, exactly one per passage. Mirrors the
--             fields of the pure SM-2 scheduler in src/scheduler.
--   reviews   append-only log of every rating applied, for stats and audits.
--
-- Time: DB defaults use now() only for row bookkeeping (created_at etc.). The
-- scheduling decisions come from the application's pure scheduler, which is
-- given `now` explicitly; even due_cards() below takes the instant as an
-- argument rather than reading the server clock.

create extension if not exists "pgcrypto";

-- ── passages ───────────────────────────────────────────────────────────────

create table public.passages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  reference  text not null check (char_length(btrim(reference)) between 1 and 200),
  text       text not null check (char_length(btrim(text)) between 1 and 20000),
  -- BCP-47-ish: primary subtag plus optional script/region subtags.
  language   text not null check (language ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  -- Script direction, derived from the primary language subtag. Keep this list
  -- in sync with RTL_LANGUAGE_SUBTAGS in src/i18n/direction.ts.
  direction  text not null generated always as (
    case
      when split_part(lower(language), '-', 1)
           in ('ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi', 'dv', 'ckb')
      then 'rtl'
      else 'ltr'
    end
  ) stored,
  source     text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, reference, language)
);

create index passages_user_language_idx on public.passages (user_id, language);

comment on column public.passages.direction is
  'Derived from language; ''rtl'' for Arabic/Hebrew/Persian/Urdu/etc., else ''ltr''.';

-- ── cards ──────────────────────────────────────────────────────────────────

create table public.cards (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  passage_id          uuid not null unique references public.passages (id) on delete cascade,
  state               text not null default 'new'
                        check (state in ('new', 'learning', 'review', 'relearning')),
  due_at              timestamptz not null default now(),
  interval_days       double precision not null default 0 check (interval_days >= 0),
  ease_factor         double precision not null default 2.5 check (ease_factor >= 1.3),
  reps                integer not null default 0 check (reps >= 0),
  lapses              integer not null default 0 check (lapses >= 0),
  learning_step_index integer not null default 0 check (learning_step_index >= 0),
  last_reviewed_at    timestamptz,
  is_suspended        boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- The core "what should I study now" query: due, not suspended, oldest first.
create index cards_due_idx on public.cards (user_id, is_suspended, due_at);
create index cards_state_idx on public.cards (user_id, state);

-- ── reviews (append-only) ──────────────────────────────────────────────────

create table public.reviews (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  card_id              uuid not null references public.cards (id) on delete cascade,
  reviewed_at          timestamptz not null,
  rating               text not null check (rating in ('again', 'hard', 'good', 'easy')),
  state_before         text not null,
  state_after          text not null,
  interval_days_before double precision not null,
  interval_days_after  double precision not null,
  ease_before          double precision not null,
  ease_after           double precision not null,
  elapsed_days         double precision,
  created_at           timestamptz not null default now()
);

create index reviews_card_idx on public.reviews (card_id, reviewed_at);
create index reviews_user_time_idx on public.reviews (user_id, reviewed_at);

-- ── bookkeeping triggers ───────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger passages_touch_updated_at
  before update on public.passages
  for each row execute function public.touch_updated_at();

create trigger cards_touch_updated_at
  before update on public.cards
  for each row execute function public.touch_updated_at();

-- Importing a passage automatically creates its (new) card, so the JSON import
-- only has to write to `passages`.
create or replace function public.create_card_for_passage()
returns trigger
language plpgsql
as $$
begin
  insert into public.cards (user_id, passage_id, due_at)
  values (new.user_id, new.id, now())
  on conflict (passage_id) do nothing;
  return new;
end;
$$;

create trigger passages_create_card
  after insert on public.passages
  for each row execute function public.create_card_for_passage();

-- ── due-queue helper ───────────────────────────────────────────────────────

-- Returns the caller's due cards as of `p_now`. Time is a parameter, never the
-- server clock, matching the pure scheduler's contract.
create or replace function public.due_cards(p_now timestamptz, p_limit int default 50)
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
  order by due_at asc
  limit greatest(coalesce(p_limit, 50), 0);
$$;

-- ── row-level security ─────────────────────────────────────────────────────

alter table public.passages enable row level security;
alter table public.cards    enable row level security;
alter table public.reviews  enable row level security;

create policy passages_owner on public.passages
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy cards_owner on public.cards
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- reviews are immutable: owners may read and insert, but not update or delete.
create policy reviews_select_owner on public.reviews
  for select
  using (user_id = auth.uid());

create policy reviews_insert_owner on public.reviews
  for insert
  with check (user_id = auth.uid());
