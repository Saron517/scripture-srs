/**
 * Script-direction helpers for rendering passages.
 *
 * The tool stores `text` and `language` per passage and must render each
 * passage in its own script direction: an Arabic verse is right-to-left even
 * when the surrounding UI chrome is English, and an English verse is
 * left-to-right inside an Arabic UI. Components should therefore set `dir` and
 * `lang` on the element that renders passage text, not rely on a single
 * document-level direction.
 *
 * Keep `RTL_LANGUAGE_SUBTAGS` in sync with the `direction` generated column in
 * `supabase/migrations/0001_init.sql`.
 */

export type Direction = 'ltr' | 'rtl';

/** Primary language subtags whose script runs right-to-left. */
export const RTL_LANGUAGE_SUBTAGS: ReadonlySet<string> = new Set([
  'ar', // Arabic
  'he', // Hebrew
  'fa', // Persian / Farsi
  'ur', // Urdu
  'ps', // Pashto
  'sd', // Sindhi
  'yi', // Yiddish
  'dv', // Dhivehi / Maldivian
  'ckb', // Central Kurdish / Sorani
]);

/**
 * Base direction for a BCP-47 tag or bare ISO-639 code.
 * Unknown or empty input falls back to `'ltr'`.
 *
 * Examples: `en` / `zh` / `zh-Hans` / `hi-IN` -> `ltr`; `ar` / `ar-EG` -> `rtl`.
 */
export function directionForLanguage(language: string): Direction {
  if (!language) return 'ltr';
  const primary = language.toLowerCase().split(/[-_]/)[0] ?? '';
  return RTL_LANGUAGE_SUBTAGS.has(primary) ? 'rtl' : 'ltr';
}

/**
 * Attributes to spread onto the DOM element (or React element) that renders a
 * passage's text, e.g. `<p {...passageTextAttrs(passage.language)}>{text}</p>`.
 */
export function passageTextAttrs(language: string): { lang: string; dir: Direction } {
  return { lang: language, dir: directionForLanguage(language) };
}
