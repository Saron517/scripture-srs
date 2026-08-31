import { describe, expect, it } from 'vitest';

import { directionForLanguage, passageTextAttrs } from '../src/i18n/direction.js';

describe('directionForLanguage', () => {
  it('marks Arabic and other RTL scripts as rtl', () => {
    for (const tag of ['ar', 'ar-EG', 'AR', 'ar_SA', 'he', 'fa', 'ur', 'ckb']) {
      expect(directionForLanguage(tag)).toBe('rtl');
    }
  });

  it('marks English, Mandarin and Hindi as ltr', () => {
    for (const tag of ['en', 'en-US', 'zh', 'zh-Hans', 'zh-Hant-TW', 'hi', 'hi-IN']) {
      expect(directionForLanguage(tag)).toBe('ltr');
    }
  });

  it('falls back to ltr for empty or unknown input', () => {
    expect(directionForLanguage('')).toBe('ltr');
    expect(directionForLanguage('xx')).toBe('ltr');
    expect(directionForLanguage('zxx')).toBe('ltr');
  });
});

describe('passageTextAttrs', () => {
  it('returns lang + dir ready to spread onto the rendering element', () => {
    expect(passageTextAttrs('ar')).toEqual({ lang: 'ar', dir: 'rtl' });
    expect(passageTextAttrs('hi')).toEqual({ lang: 'hi', dir: 'ltr' });
    expect(passageTextAttrs('zh-Hans')).toEqual({ lang: 'zh-Hans', dir: 'ltr' });
  });
});
