# scripture-srs

A multilingual scripture‑memorization tool — one screen at `/review`, backed by
Supabase and an SM‑2 spaced‑repetition scheduler. Pick up the next verse that's
due, recite it, reveal, and grade yourself; the schedule updates and the verse
comes back later.

- **Live:** https://scripture-srs.vercel.app/review
- **Repo:** https://github.com/Saron517/scripture-srs

---

## Submission

### 1. Hours spent

About 3 hours, most of it spent debugging deployment and auth issues rather than the core scheduling logic itself.

### 2. Hardest decision: requiring sign‑in on the review screen, then removing it

Every table has a security rule that only lets you see rows tied to your own account (auth.uid()). That's the right way to build something multiple people will use, but it created a real problem. If someone visits /review without signing in, they don't get an error, they just see an empty screen with no verses to review. It looks broken even though nothing is technically wrong.

At first I added a simple magic link sign in (an email with a link you click to log in, no password needed) to solve this. But once I actually tested it with an outside reviewer, it broke in three different ways in a row: the login email pointed to my local computer instead of the live site, a new user account failed to create in the database, and then Supabase's email system hit a rate limit from too many attempts. Each of those was a real, separate bug, not the same one repeating.

After the third failure, I made the call to remove sign in from the review screen entirely and replace it with a shared "demo mode" that anyone can use immediately, no login at all. This meant writing new database policies that let anyone read and update one fixed demo account's data, instead of requiring their own account. It felt like a step backward from proper multi user design, but it was the right call given that the whole point was for someone else to actually be able to test it without me standing over their shoulder.

### 3. One thing I know is hacky

next.config.mjs has a setting called extensionAlias that tells the bundler to treat .js file imports as if they were .ts files. My scheduler code imports its own files using .js at the end, which is normal in plain JavaScript projects, but Next.js's default bundler doesn't automatically know those .js imports actually point to .ts files, so I forced it to understand that with this setting. The catch is this only works with one specific bundler. If someone runs the newer, faster dev server instead, it breaks with no warning at all, and nothing in the scheduler code explains why this setting exists. The clean fix would be to remove the .js extensions from the imports or turn the scheduler into its own separate package. I didn't have time to do either.

A second thing, smaller but still worth naming: because reviewing a card pushes it to a future due date, once someone finishes reviewing everything, the app just says nothing is due, with no way to try it again without resetting the data. I ended up adding a "Reset demo deck" button directly in the app so anyone can reset it themselves without needing database access, but this only exists because the natural behavior of a spaced repetition app makes repeat demoing awkward.

### 4. How I used AI

I used Claude Code to build the app and reviewed each piece as it came back to me. I handed it the database schema, the scheduling logic, the tests, and the actual screen. I pushed back on scope more than once: I told it to skip building a verse picker or handling translation licensing, since verses just get imported from a file, and I insisted the scheduler stay a pure function that never reads the system clock so it could actually be tested. I also overrode its suggestion during a git conflict, choosing to force push over its suggested rebase since the remote only held an empty placeholder file. The most valuable part of working with it happened during deployment, when a reviewer hit a real bug I couldn't reproduce myself. I had Claude Code check the actual database directly rather than guessing, which is how we found the real problem: a stale link pointing to an old, frozen version of the site.

---

## Layout

| Path | What it is |
| --- | --- |
| `supabase/migrations/0001_init.sql` | `passages`, `cards`, `reviews` tables + RLS, triggers, `due_cards(now, limit)` |
| `src/scheduler/` | Pure SM‑2 scheduler — `createCard`, `review`, `isDue` |
| `src/i18n/direction.ts` | `directionForLanguage` / `passageTextAttrs` for RTL rendering |
| `app/`, `lib/supabase/` | Next.js (App Router) app — the `/review` screen |
| `test/` | Unit tests + deterministic 30‑day simulation |
| `scripts/import-passages.ts` | Load a verses JSON file into `passages` |
| `scripts/sim-report.ts` | Print the 30‑day simulation as tables: `npx tsx scripts/sim-report.ts [seed] [days]` |

## Commands

```bash
npm install
npm run dev       # Next.js dev server → http://localhost:3000 (redirects to /review)
npm run build     # production build
npm test          # vitest run — 25 tests
npm run typecheck # tsc --noEmit
```

## The `/review` screen

`app/review/page.tsx` is a client component. It:

1. Reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from
   `.env.local` (`lib/supabase/client.ts`, via `@supabase/ssr`
   `createBrowserClient`).
2. Signs the user in with a magic link (`signInWithOtp`) — required because every
   table's RLS policy is scoped to `auth.uid()`, so an anonymous client sees no
   rows.
3. Loads the due queue: `cards` embedded with `passages`, filtered
   `is_suspended = false` and `due_at <= now`, ordered by `due_at`.
4. Per card: shows the reference → **Reveal** → passage text rendered with its own
   `dir`/`lang` (`passageTextAttrs`) → four rating buttons with next‑interval
   previews.
5. On a rating, runs the pure `review()` (the **UI** supplies `now = Date.now()`),
   then `UPDATE cards` + `INSERT reviews`.

Only a browser client is wired up. For server components / SSR auth, add the
`@supabase/ssr` server client and a session‑refresh middleware.

`.env.local` is git‑ignored (`.env.*`). The anon key is meant to ship to the
browser; RLS is what protects data.

## The scheduler

`src/scheduler/sm2.ts` is an SM‑2 (Anki‑style) variant with explicit learning and
relearning steps. Two hard rules:

1. **Pure.** The input `Card` is never mutated; `review()` returns a new card plus
   a log row.
2. **No ambient clock.** Time enters only through the `now` argument (epoch ms).
   Nothing calls `Date.now()`, `new Date()`, or `performance.now()`. Same
   arguments → same result, whenever it runs. A non‑finite `now` throws.

```ts
import { createCard, review, isDue } from './src/scheduler';

let card = createCard(now);                 // `now`: epoch ms, from the caller
if (isDue(card, now)) {
  const { card: next, log } = review(card, 'good', now); // 'again'|'hard'|'good'|'easy'
  // persist `next` to cards, insert `log` into reviews
}
```

`Card` fields map 1:1 to columns on `cards`; `ReviewLog` fields map to `reviews`.
Tune behaviour by passing a `Partial<SchedulerConfig>` as the 4th argument
(`DEFAULT_CONFIG` in `src/scheduler/types.ts`): learning steps, ease floor,
interval cap, etc. Interval fuzzing is intentionally omitted so results stay
deterministic; if you add it, inject a seeded `rng` (see `src/scheduler/prng.ts`)
rather than using global randomness.

### State machine

`new → learning → review`, with `review → relearning → review` on a lapse.
`again` in `review` drops ease by 0.20 (floored at `minEaseFactor`), increments
`lapses`, and sends the card to `relearning`. A card whose ease has bottomed out
with `lapses` climbing and interval stuck at the floor is a *leech* — the app
should flag or suspend it (`cards.is_suspended`).

## Languages & RTL

Each passage stores its own `text` and `language` (BCP‑47, e.g. `en`, `zh-Hans`,
`ar`, `hi`). Direction is per passage, not per app:

- **DB:** `passages.direction` is a generated column — `rtl` for Arabic, Hebrew,
  Persian, Urdu, etc., otherwise `ltr`.
- **UI:** set `dir` and `lang` on the element that renders the verse so an Arabic
  passage is right‑to‑left even inside an English UI (and vice versa):

  ```tsx
  import { passageTextAttrs } from './src/i18n/direction';
  <p {...passageTextAttrs(passage.language)}>{passage.text}</p>
  // -> <p lang="ar" dir="rtl">…</p>
  ```

  Build components with CSS logical properties (`margin-inline-start`,
  `text-align: start`, `padding-inline`) so they mirror automatically. For
  strings that mix scripts inline, wrap the foreign run in `<bdi>` or
  `dir="auto"`.

Keep the RTL list in `src/i18n/direction.ts` (`RTL_LANGUAGE_SUBTAGS`) in sync
with the `CASE` in the migration's `direction` column.

## Importing verses

```bash
npm i @supabase/supabase-js
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... IMPORT_USER_ID=<uuid> \
  npx tsx scripts/import-passages.ts ./verses.json
```

Inserting a `passages` row auto‑creates its `cards` row (trigger), so the import
only touches `passages`. `direction` is computed by the DB.

## Tests

- `test/scheduler.unit.test.ts` — every state transition, ease floor, interval
  cap, "successful review always moves the due date out", clock‑independence,
  input not mutated.
- `test/simulate.ts` + `test/scheduler.simulation.test.ts` — six passages
  (English, Mandarin, Arabic ×2, Hindi) with `diligent` / `realistic` / `leech`
  learner profiles played through 30 daily sessions using a seeded PRNG and a
  fixed epoch anchor. Asserts full determinism (same seed → identical history),
  per‑transition invariants, and sensible month‑end outcomes per profile.
