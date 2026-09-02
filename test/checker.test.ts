import { describe, expect, it } from 'vitest';

import { checkAnswer, normalizeForCheck, type CheckLang } from '../src/checker/index.js';
import fixtures from './fixtures/b_check_answers.json' with { type: 'json' };

interface Fixture {
  reference: string;
  lang: string;
  change: string;
  card: string;
  input: string;
  expected: string;
}

/** First word of the expected verdict prose: "Correct." / "Partial." / "Incorrect." */
function expectedVerdict(prose: string): 'correct' | 'partial' | 'incorrect' {
  return prose.split(/[.\s]/)[0]!.toLowerCase() as 'correct' | 'partial' | 'incorrect';
}

// Matthew 28:19 (en) carries two prose discrepancies against a literal reading
// of B_Cards + B_Rules; both are documented deviations, verdict category still
// matches:
//   - "Empty string": sheet says "0 of 22 words matched"; the B_Cards text
//     tokenises to 24 words on whitespace, so we report 24.
//   - "Curly apostrophe and quotes": sheet says the wrong word is at position
//     16; "Father's" -> "fathers" (curly apostrophe straightened then stripped)
//     is one token, so position-by-position comparison puts it at 15.
const MATTHEW_CARD_WORDS_OURS = 24; // B_Cards tokenised on whitespace (sheet: 22)

describe('B_Check_Answers conformance', () => {
  const rows = fixtures as Fixture[];

  it('covers all 21 rows', () => {
    expect(rows).toHaveLength(21);
  });

  rows.forEach((fx) => {
    it(`${fx.reference} (${fx.lang}) — ${fx.change}`, () => {
      const result = checkAnswer(fx.input, fx.card, fx.lang as CheckLang);
      expect(result.verdict).toBe(expectedVerdict(fx.expected));
    });
  });

  it('reproduces the exact numeric prose the sheet spells out', () => {
    const byKey = (ref: string, change: string) =>
      rows.find((r) => r.reference === ref && r.change === change)!;

    // "Partial. 1 of 9 words wrong at position 5 (shepard / shepherd)."
    const misspell = byKey('Psalm 23:1', 'One word misspelled');
    expect(checkAnswer(misspell.input, misspell.card, 'en').summary).toBe(
      'Partial. 1 of 9 words wrong at position 5 (shepard / shepherd).',
    );

    // "Partial. 7 of 10 words matched; 3 missing from position 8."
    const truncated = byKey('Philippians 4:13', 'Truncated after 7 words');
    expect(checkAnswer(truncated.input, truncated.card, 'en').summary).toBe(
      'Partial. 7 of 10 words matched; 3 missing from position 8.',
    );

    // Sheet: "Incorrect. 0 of 22 words matched." The B_Cards text tokenises to
    // 24 words, so we report 24 — verdict category still matches.
    const empty = byKey('Matthew 28:19', 'Empty string');
    expect(checkAnswer(empty.input, empty.card, 'en').summary).toBe(
      `Incorrect. 0 of ${MATTHEW_CARD_WORDS_OURS} words matched.`,
    );
  });

  it('reports the mismatch position, count, and words for substitutions', () => {
    const misspell = fixtures.find((r) => r.change === 'One word misspelled') as Fixture;
    const r = checkAnswer(misspell.input, misspell.card, 'en');
    expect(r.mismatches).toEqual([{ position: 5, got: 'shepard', expected: 'shepherd' }]);
    expect(r.matched).toBe(8);
    expect(r.total).toBe(9);
  });

  it('reports the first missing position for a truncated answer', () => {
    const truncated = fixtures.find((r) => r.change === 'Truncated after 7 words') as Fixture;
    const r = checkAnswer(truncated.input, truncated.card, 'en');
    expect(r.missingFrom).toBe(8);
    expect(r.matched).toBe(7);
    expect(r.mismatches).toHaveLength(0);
  });

  it('counts differing characters for wrong-script Chinese', () => {
    const trad = fixtures.find((r) => r.change.includes('Traditional characters')) as Fixture;
    const r = checkAnswer(trad.input, trad.card, 'zh');
    expect(r.verdict).toBe('incorrect');
    expect(r.differingChars).toBeGreaterThan(0);
  });

  it('note: documented Matthew 28:19 deviations (position 15 not 16)', () => {
    const fx = (fixtures as Fixture[]).find(
      (r) => r.reference === 'Matthew 28:19' && r.change === 'Curly apostrophe and quotes',
    )!;
    const r = checkAnswer(fx.input, fx.card, 'en');
    expect(r.verdict).toBe('partial');
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0]!.position).toBe(15); // sheet says 16
    expect(r.total).toBe(MATTHEW_CARD_WORDS_OURS); // sheet says 22
  });
});

describe('normalizeForCheck', () => {
  it('strips punctuation across scripts, folds case, collapses whitespace', () => {
    expect(normalizeForCheck('  The   LORD  is my shepherd;  ', 'en')).toBe(
      'the lord is my shepherd',
    );
  });

  it('normalises curly quotes to straight, then strips them', () => {
    expect(normalizeForCheck('the ‘Father’s’ house', 'en')).toBe('the fathers house');
  });

  it('maps full-width comma to ASCII and then strips it (Chinese)', () => {
    expect(normalizeForCheck('神爱世人，甚至', 'zh')).toBe(
      '神爱世人甚至',
    );
  });

  it('drops Arabic harakat and normalises alef wasla', () => {
    // "لِأَنَّهُ" with harakat + alef wasla -> bare consonantal skeleton
    expect(normalizeForCheck('لِأَنَّهُ', 'ar')).toBe(
      'لأنه',
    );
    expect(normalizeForCheck('ٱلله', 'ar')).toBe('الله');
  });

  it('treats the Devanagari nukta as optional', () => {
    // ज + ़ (nukta) vs bare ज
    expect(normalizeForCheck('ज़मीन', 'hi')).toBe(
      normalizeForCheck('जमीन', 'hi'),
    );
  });

  it('does not convert traditional Chinese to simplified', () => {
    expect(normalizeForCheck('愛', 'zh')).not.toBe(normalizeForCheck('爱', 'zh'));
  });
});
