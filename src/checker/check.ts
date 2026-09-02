/**
 * Compare a reviewer's typed answer against a card, per the Build Lane Challenge
 * Option B `B_Rules` "Partial credit" section.
 *
 *   Word languages (en, ar, hi): split on whitespace after normalising, compare
 *     position by position, report the count and 1-based position of each
 *     mismatch. Words present in the card but absent from the input are
 *     "missing", reported from the first absent position.
 *   Chinese: no whitespace to split on — compare character by character and
 *     report the count of differing characters.
 *
 * Verdict mapping (the sheet's verdicts are human prose; this is our rule):
 *   correct   — exact match after normalisation
 *   incorrect — nothing matched, or the substitution rate over the compared
 *               region is >= INCORRECT_RATIO (e.g. wrong-script input)
 *   partial   — anything else
 */

import { type CheckLang, normalizeForCheck } from './normalize.js';

export type { CheckLang } from './normalize.js';
export { normalizeForCheck } from './normalize.js';

export type Verdict = 'correct' | 'partial' | 'incorrect';

/** Substitution rate over the compared region at or above which we say incorrect. */
export const INCORRECT_RATIO = 0.2;

export interface Mismatch {
  /** 1-based position in the card. */
  position: number;
  /** The card's unit at this position. */
  expected: string;
  /** The reviewer's unit at this position. */
  got: string;
}

export interface CheckResult {
  verdict: Verdict;
  lang: CheckLang;
  /** 'word' for en/ar/hi, 'char' for zh. */
  unit: 'word' | 'char';
  /** Units in the card. */
  total: number;
  /** Units that matched positionally. */
  matched: number;
  /** Positional substitutions within the compared region (word languages). */
  mismatches: Mismatch[];
  /** zh only: differing characters, including any length difference. */
  differingChars: number;
  /** 1-based position of the first card unit absent from the input, or null. */
  missingFrom: number | null;
  /** 1-based position at which the input runs past the card, or null. */
  extraFrom: number | null;
  /** Human-readable summary, in the style of B_Check_Answers. */
  summary: string;
  /** The normalised strings actually compared. */
  normalizedCard: string;
  normalizedInput: string;
}

export function checkAnswer(input: string, card: string, lang: CheckLang): CheckResult {
  const normalizedInput = normalizeForCheck(input, lang);
  const normalizedCard = normalizeForCheck(card, lang);
  return lang === 'zh'
    ? checkChars(normalizedInput, normalizedCard)
    : checkWords(normalizedInput, normalizedCard, lang);
}

// ── word languages (en, ar, hi) ────────────────────────────────────────────

function checkWords(input: string, card: string, lang: CheckLang): CheckResult {
  const cardWords = card.length > 0 ? card.split(' ') : [];
  const inputWords = input.length > 0 ? input.split(' ') : [];
  const total = cardWords.length;
  const compared = Math.min(cardWords.length, inputWords.length);

  const mismatches: Mismatch[] = [];
  let matched = 0;
  for (let i = 0; i < compared; i += 1) {
    if (inputWords[i] === cardWords[i]) {
      matched += 1;
    } else {
      mismatches.push({ position: i + 1, expected: cardWords[i], got: inputWords[i] });
    }
  }

  const missingFrom = inputWords.length < cardWords.length ? inputWords.length + 1 : null;
  const extraFrom = inputWords.length > cardWords.length ? cardWords.length + 1 : null;
  const verdict = decideVerdict(matched, mismatches.length, compared, missingFrom, extraFrom);

  const result: CheckResult = {
    verdict,
    lang,
    unit: 'word',
    total,
    matched,
    mismatches,
    differingChars: 0,
    missingFrom,
    extraFrom,
    summary: '',
    normalizedCard: card,
    normalizedInput: input,
  };
  result.summary = wordSummary(result, inputWords.length);
  return result;
}

// ── Chinese ────────────────────────────────────────────────────────────────

function checkChars(input: string, card: string): CheckResult {
  const cardChars = [...card];
  const inputChars = [...input];
  const total = cardChars.length;
  const compared = Math.min(total, inputChars.length);

  let matched = 0;
  let diffInRegion = 0;
  for (let i = 0; i < compared; i += 1) {
    if (inputChars[i] === cardChars[i]) matched += 1;
    else diffInRegion += 1;
  }
  const lengthDiff = Math.abs(total - inputChars.length);
  const differingChars = diffInRegion + lengthDiff;
  const missingFrom = inputChars.length < total ? inputChars.length + 1 : null;
  const extraFrom = inputChars.length > total ? total + 1 : null;
  const verdict = decideVerdict(matched, diffInRegion, compared, missingFrom, extraFrom);

  const head = verdict === 'correct' ? '' : verdict === 'incorrect' ? 'Incorrect. ' : 'Partial. ';
  const summary =
    verdict === 'correct'
      ? 'Correct.'
      : `${head}${differingChars} differing character${differingChars === 1 ? '' : 's'}.`;

  return {
    verdict,
    lang: 'zh',
    unit: 'char',
    total,
    matched,
    mismatches: [],
    differingChars,
    missingFrom,
    extraFrom,
    summary,
    normalizedCard: card,
    normalizedInput: input,
  };
}

// ── shared ─────────────────────────────────────────────────────────────────

function decideVerdict(
  matched: number,
  mismatchCount: number,
  compared: number,
  missingFrom: number | null,
  extraFrom: number | null,
): Verdict {
  if (mismatchCount === 0 && missingFrom === null && extraFrom === null) return 'correct';
  if (matched === 0) return 'incorrect';
  if (compared > 0 && mismatchCount / compared >= INCORRECT_RATIO) return 'incorrect';
  return 'partial';
}

function wordSummary(r: CheckResult, inputLen: number): string {
  if (r.verdict === 'correct') return 'Correct.';
  if (r.matched === 0 && r.mismatches.length === 0) {
    return `Incorrect. 0 of ${r.total} words matched.`;
  }

  const head = r.verdict === 'incorrect' ? 'Incorrect' : 'Partial';
  const clauses: string[] = [];

  if (r.mismatches.length > 0) {
    const where = r.mismatches
      .map((m) => `position ${m.position} (${m.got} / ${m.expected})`)
      .join(', ');
    clauses.push(`${r.mismatches.length} of ${r.total} words wrong at ${where}`);
  } else if (r.missingFrom !== null) {
    clauses.push(`${r.matched} of ${r.total} words matched`);
  }

  if (r.missingFrom !== null) {
    const missing = r.total - r.matched - r.mismatches.length;
    clauses.push(`${missing} missing from position ${r.missingFrom}`);
  }
  if (r.extraFrom !== null) {
    const extra = inputLen - r.total;
    clauses.push(`${extra} extra word${extra === 1 ? '' : 's'} from position ${r.extraFrom}`);
  }

  return `${head}. ${clauses.join('; ')}.`;
}
