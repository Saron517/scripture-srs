/**
 * Answer-checking normalisation, per the Build Lane Challenge Option B `B_Rules`
 * tab ("Answer checking — ignore / normalize / do NOT normalize").
 *
 * Applied identically to the card text and the reviewer's input before they are
 * compared. Order matters: quote / full-width / script fixes happen before
 * punctuation is stripped, so a curly apostrophe first becomes a straight one
 * and is then removed as punctuation.
 */

export type CheckLang = 'en' | 'ar' | 'hi' | 'zh';

// Arabic marks removed when harakat normalisation applies:
// U+064B–U+0652, plus the tatweel U+0640 and the superscript alef U+0670.
const ARABIC_HARAKAT = /[ً-ْـٰ]/g;
const ALEF_WASLA = /ٱ/g; // -> plain alef U+0627
const ALEF_MAQSURA = /ى/g; // -> yeh U+064A
const DEVANAGARI_NUKTA = /़/g; // optional: present or absent
const CURLY_SINGLE = /[‘’]/g;
const CURLY_DOUBLE = /[“”]/g;
const FULLWIDTH_COMMA = /，/g;
const FULLWIDTH_SEMICOLON = /；/g;

export function normalizeForCheck(text: string, lang: CheckLang): string {
  let s = text.normalize('NFC');

  // ── normalize ──
  s = s.replace(CURLY_SINGLE, "'").replace(CURLY_DOUBLE, '"');
  s = s.replace(FULLWIDTH_COMMA, ',').replace(FULLWIDTH_SEMICOLON, ';');

  if (lang === 'ar') {
    s = s.replace(ARABIC_HARAKAT, '');
    s = s.replace(ALEF_WASLA, 'ا');
    s = s.replace(ALEF_MAQSURA, 'ي');
  }

  if (lang === 'hi') {
    // Decompose any precomposed nukta letters first, then drop the mark.
    s = s.normalize('NFD').replace(DEVANAGARI_NUKTA, '');
  }

  // ── ignore ──
  // Punctuation: strip entirely, every script. \p{P} covers the Arabic comma
  // U+060C, the Devanagari danda U+0964 and double danda U+0965, the
  // now-straight quotes, exclamation marks, etc.
  s = s.replace(/\p{P}/gu, '');
  // Case.
  s = s.toLowerCase();
  // Whitespace: trim the ends, collapse internal runs to a single space.
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}
