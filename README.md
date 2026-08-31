# scripture-srs

A multilingual scripture‑memorization tool — one screen at `/review`, backed by
Supabase and an SM‑2 spaced‑repetition scheduler. Pick up the next verse that's
due, recite it, reveal, and grade yourself; the schedule updates and the verse
comes back later.

- **Live:** https://scripture-srs-saron517.vercel.app
- **Repo:** https://github.com/Saron517/scripture-srs

---

## Submission

### 1. Hours spent

About 2 hours and half.

### 2. The hardest decision, and why

What was hard: deciding whether the /review screen should require signing in at all.

Why: every table has a security rule that only lets you see rows tied to your own account (auth.uid()). That's the right way to build something multiple people will use, but it created a problem. If someone visits /review without signing in, they don't get an error, they just see an empty screen with no verses to review. It looks broken even though nothing is actually wrong.

That left me with two options. I could leave the screen open to anyone, but it wouldn't actually work until I built a real login system later. Or I could add sign in right now, even though this was supposed to be a small, single screen task.

I chose to add a simple sign in using magic links (an email with a link you click to log in, no password needed), and wrote down what still needs to be set up in Supabase for it to fully work. Making the task bigger than planned felt like the wrong move at first, but shipping a screen that couldn't actually show anything felt worse
### 3. One thing I know is hacky


next.config.mjs has a setting called extensionAlias that tells the bundler to treat .js file imports as if they were .ts files. Here's why I needed it: the scheduler code in src/ imports its own files using .js at the end (a normal thing to do in plain JavaScript projects), but Next.js's default bundler doesn't automatically know those .js imports actually point to .ts files. So I forced it to understand that with this setting.

The catch: this only works with one specific bundler (webpack). If someone runs the newer, faster dev server (Turbopack) instead, it breaks with no warning at all, and nothing in the scheduler code itself explains why this setting exists. The real fix would be to either remove the .js extensions from the imports, or turn src/ into its own separate package. I didn't have time to do either.

A smaller thing: there's one spot in the review page where I forced TypeScript to accept a type using as unknown as CardRow[]. I did that because I wrote the data types by hand instead of generating them automatically from the database, so I had to manually convince the type checker.

### 4. How I used AI

I used Claude Code to actually build the app, and reviewed each piece as it came back to me. I handed it the Supabase schema, the SM2 scheduler, the tests, and the /review screen in Next.js. I pushed back on scope twice: I told it to skip building a passage picker and any translation licensing logic, since verses just get imported from a JSON file, and I insisted the scheduler stay a pure function that never reads the system clock, so it could actually be tested properly. I also overrode its suggestion during a Git problem: when my first push got rejected, it suggested rebasing, but I chose to force push instead, since the only thing on the remote was GitHub's automatically generated placeholder README.

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
