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
| `supabase/migrations/` | `0001` schema/RLS · `0002` demo mode · `0003` Leitner box columns · `0004` seed the B_Cards deck for the demo user |
| `src/scheduler/leitner.ts` | Pure Leitner box scheduler (Build Lane Challenge `B_Rules`) — `createCard`, `review`, `isDue`, `selectDueQueue` |
| `src/scheduler/sm2.ts` | Earlier SM‑2 scheduler — kept for reference, no longer wired to the app |
| `src/checker/` | Pure answer checker (`B_Rules` "Answer checking" / "Partial credit") — `normalizeForCheck`, `checkAnswer` |
| `src/i18n/direction.ts` | `directionForLanguage` / `passageTextAttrs` for RTL rendering |
| `app/`, `lib/supabase/` | Next.js (App Router) app — the `/review` screen |
| `test/` | Unit tests + deterministic 30‑day simulation |
| `scripts/b-cards.json` | The Build Lane Challenge B_Cards deck (16 passages, en/zh/ar/hi) |
| `scripts/import-passages.ts` | Load a verses JSON file into `passages` |
| `scripts/sim-report.ts` | Print the 30‑day simulation as tables: `npx tsx scripts/sim-report.ts [seed] [days]` |

## Commands

```bash
npm install
npm run dev       # Next.js dev server → http://localhost:3000 (redirects to /review)
npm run build     # production build
npm test          # vitest run — 81 tests (B_Check_Schedule + B_Check_Answers conformance)
npm run typecheck # tsc --noEmit
```

## The `/review` screen

`app/review/page.tsx` is a client component. It:

1. Reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from
   `.env.local` (`lib/supabase/client.ts`, via `@supabase/ssr`
   `createBrowserClient`).
2. **Demo mode, no sign-in.** `0002_demo_mode.sql` opens one fixed demo user's
   rows to the anon role, so `/review` reads and writes that shared deck with no
   auth. A "Reset demo deck" button re-arms it.
3. Loads the due queue: `cards` embedded with `passages`, filtered
   `is_suspended = false` and `due_at <= now`, then ordered client-side by
   `selectDueQueue()` — most overdue → lowest box → reference A-Z, capped at 20
   (`B_Rules` daily cap).
4. Per card: shows the reference. For a language the checker knows
   (`en`/`ar`/`hi`/`zh`) you can type the passage and **Check** it — that runs
   the pure `checkAnswer()` and reveals the verse with a
   `correct`/`partial`/`incorrect` verdict; **Reveal without checking** skips
   straight to the text. Either way the passage renders with its own `dir`/`lang`
   (`passageTextAttrs`), then four grade buttons with next-interval previews.
5. On a grade, runs the pure `review()` (the **UI** supplies `now`), then
   `UPDATE cards` (box, due date) + `INSERT reviews` (box transition).

**Simulated clock.** Every clock read on the page — queue load, previews, the
grade write, the demo reset — goes through one `now = Date.now() + offset`. The
**+1 day / +7 days / Today** control moves `offset` in whole days (persisted to
`localStorage`), so the shared demo deck can be pushed past its due dates
without waiting real time. The scheduler itself still never reads a clock.

`.env.local` is git-ignored (`.env.*`). The anon key is meant to ship to the
browser; RLS is what protects data.

## The scheduler

`src/scheduler/leitner.ts` implements the Leitner box system from the Build Lane
Challenge Option B `B_Rules` tab. Two hard rules:

1. **Pure.** The input `Card` is never mutated; `review()` returns a new card plus
   a log row.
2. **No ambient clock.** Time enters only through the `now` argument (epoch ms).
   Nothing calls `Date.now()`, `new Date()`, or `performance.now()`. Same
   arguments → same result, whenever it runs. A non-finite `now` throws.

```ts
import { createCard, review, isDue } from './src/scheduler/leitner';

let card = createCard(now);                 // box 0, due now — `now` is epoch ms
if (isDue(card, now)) {
  const { card: next, log } = review(card, 'good', now); // 'again'|'hard'|'good'|'easy'
  // persist `next` to cards, insert `log` into reviews
}
```

### Box rules

| Box | 0 | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- | --- |
| Interval | same day | 1d | 3d | 7d | 21d | 60d (max) |

- `again` → box 0 · `good` → box +1 · `easy` → box +2 (both capped at 5)
- `hard` → box unchanged; interval = `floor(0.6 × box interval)`, min 1 day
- Next due date = **review instant + interval** (a late review reschedules from
  when it happened, not from the old due date)

`test/leitner.schedule.test.ts` replays all 8 `B_Check_Schedule` traces
step-for-step. `test/leitner.test.ts` covers each grade, the `hard` floor at every
box, purity, and `selectDueQueue` ordering.

## Answer checking

`src/checker/` grades a typed recitation against the card, following the
`B_Rules` "Answer checking" and "Partial credit" sections. Like the scheduler
it is pure — no I/O, no clock.

- `normalize.ts` applies the **same** normalisation to the card and the input
  before comparing: NFC, curly quotes → straight, full-width punctuation →
  ASCII, Arabic harakat / alef-wasla / alef-maqsura, the Devanagari nukta —
  then strips all punctuation, folds case, collapses whitespace.
- `check.ts` compares word-by-word for `en` / `ar` / `hi` (the count and
  1-based position of every mismatch, plus missing / extra runs) and
  character-by-character for `zh`. The verdict is `correct`, `partial`, or
  `incorrect` — `incorrect` once the substitution rate over the compared region
  reaches `INCORRECT_RATIO` (0.2), or nothing matched at all.

`test/checker.test.ts` replays all 21 `B_Check_Answers` rows and asserts the
exact numeric prose the sheet spells out.

### Two deviations from `B_Check_Answers`

Both are on the English **Matthew 28:19** card, and in both the verdict
*category* still matches the sheet — only a number differs.

1. **Word count — we report 24, the sheet says 22.** The "Empty string" row's
   expected prose is "0 of 22 words matched". The B_Cards text for that verse
   ("Go ye therefore, and teach all nations, baptizing them in the name of the
   Father, and of the Son, and of the Holy Ghost:") is 24 whitespace-separated
   tokens, and the checker tokenises on whitespace, so it reports 24.
2. **Mismatch position — we report 15, the sheet says 16.** In the "Curly
   apostrophe and quotes" row the input reads "Father’s" where the card has
   "Father". Normalisation straightens the curly apostrophe and then strips it,
   so "Father’s" collapses to the single token "fathers"; position-by-position
   comparison puts the wrong word at 15. Position 16 would be correct only if
   the apostrophe had split it into two tokens.

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

The Build Lane Challenge deck is committed as `scripts/b-cards.json` (16
passages, `en`/`zh-Hans`/`ar`/`hi`; the text is byte-identical to the checker's
`B_Check_Answers` fixtures). Migration `0004_seed_b_cards.sql` loads it into the
shared demo account, so the live `/review` deck comes up populated —
`npx tsx scripts/import-passages.ts scripts/b-cards.json` does the same against
any user.

## Tests

- `test/scheduler.unit.test.ts` — every state transition, ease floor, interval
  cap, "successful review always moves the due date out", clock‑independence,
  input not mutated.
- `test/simulate.ts` + `test/scheduler.simulation.test.ts` — six passages
  (English, Mandarin, Arabic ×2, Hindi) with `diligent` / `realistic` / `leech`
  learner profiles played through 30 daily sessions using a seeded PRNG and a
  fixed epoch anchor. Asserts full determinism (same seed → identical history),
  per‑transition invariants, and sensible month‑end outcomes per profile.
