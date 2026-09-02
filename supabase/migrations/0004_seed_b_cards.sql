-- ─────────────────────────────────────────────────────────────────────────────
-- Seed the B_Cards deck (Build Lane Challenge Option B, B_Cards tab) into the
-- shared demo account so the live /review screen always has something to review.
--
--     DEMO_USER_ID = 5f3fc43e-cdaa-4bf5-849e-b79834150da0
--
-- 16 passages: 5 English (KJV), 3 Simplified Chinese (CUV), 4 Arabic (SVD,
-- vocalised), 4 Hindi (BSI). The text is byte-for-byte the same string used as
-- the card in test/fixtures/b_check_answers.json, so the answer checker and the
-- live deck agree exactly (the Arabic keeps its combining harakat in the
-- sheet's original order). The canonical copy is scripts/b-cards.json.
--
-- Idempotent: "on conflict (user_id, reference, language) do nothing", so
-- re-running this migration changes nothing. Each inserted passage fires the
-- passages_create_card trigger from 0001_init.sql, which creates its card at
-- box 0, due now() — immediately reviewable.
--
-- SQL equivalent of running, with the demo user's id:
--   npx tsx scripts/import-passages.ts scripts/b-cards.json
-- ─────────────────────────────────────────────────────────────────────────────

begin;

insert into public.passages (user_id, reference, language, text, source)
values
  ('5f3fc43e-cdaa-4bf5-849e-b79834150da0', 'John 3:16', 'en', 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.', 'KJV'),
  ('5f3fc43e-cdaa-4bf5-849e-b79834150da0', 'Psalm 23:1', 'en', 'The LORD is my shepherd; I shall not want.', 'KJV'),
  ('5f3fc43e-cdaa-4bf5-849e-b79834150da0', 'Philippians 4:13', 'en', 'I can do all things through Christ which strengtheneth me.', 'KJV'),
  ('5f3fc43e-cdaa-4bf5-849e-b79834150da0', 'Matthew 28:19', 'en', 'Go ye therefore, and teach all nations, baptizing them in the name of the Father, and of the Son, and of the Holy Ghost:', 'KJV'),
  ('5f3fc43e-cdaa-4bf5-849e-b79834150da0', 'Leviticus 19:34', 'en', 'But the stranger that dwelleth with you shall be unto you as one born among you, and thou shalt love him as thyself; for ye were strangers in the land of Egypt: I am the LORD your God.', 'KJV'),
  ('5f3fc43e-cdaa-4bf5-849e-b79834150da0', 'John 3:16', 'zh-Hans', '神爱世人，甚至将他的独生子赐给他们，叫一切信他的，不致灭亡，反得永生。', 'CUV'),
  ('5f3fc43e-cdaa-4bf5-849e-b79834150da0', 'Philippians 4:13', 'zh-Hans', '我靠著那加给我力量的，凡事都能做。', 'CUV'),
  ('5f3fc43e-cdaa-4bf5-849e-b79834150da0', 'Psalm 23:1', 'zh-Hans', '耶和华是我的牧者，我必不致缺乏。', 'CUV'),
  ('5f3fc43e-cdaa-4bf5-849e-b79834150da0', 'Romans 8:28', 'ar', 'وَنَحْنُ نَعْلَمُ أَنَّ كُلَّ ٱلْأَشْيَاءِ تَعْمَلُ مَعًا لِلْخَيْرِ لِلَّذِينَ يُحِبُّونَ ٱللهَ، ٱلَّذِينَ هُمْ مَدْعُوُّونَ حَسَبَ قَصْدِهِ.', 'SVD'),
  ('5f3fc43e-cdaa-4bf5-849e-b79834150da0', 'John 3:16', 'ar', 'لِأَنَّهُ هَكَذَا أَحَبَّ ٱللهُ ٱلْعَالَمَ حَتَّى بَذَلَ ٱبْنَهُ ٱلْوَحِيدَ، لِكَيْ لَا يَهْلِكَ كُلُّ مَنْ يُؤْمِنُ بِهِ، بَلْ تَكُونُ لَهُ ٱلْحَيَاةُ ٱلْأَبَدِيَّةُ.', 'SVD'),
  ('5f3fc43e-cdaa-4bf5-849e-b79834150da0', 'Philippians 4:13', 'ar', 'أَسْتَطِيعُ كُلَّ شَيْءٍ فِي ٱلْمَسِيحِ ٱلَّذِي يُقَوِّينِي.', 'SVD'),
  ('5f3fc43e-cdaa-4bf5-849e-b79834150da0', 'Proverbs 3:5', 'ar', 'تَوَكَّلْ عَلَى ٱلرَّبِّ بِكُلِّ قَلْبِكَ، وَعَلَى فَهْمِكَ لَا تَعْتَمِدْ.', 'SVD'),
  ('5f3fc43e-cdaa-4bf5-849e-b79834150da0', 'Isaiah 40:31', 'hi', 'परन्तु जो यहोवा की बाट जोहते हैं, वे नया बल प्राप्त करते जाएंगे, वे उकाबों की नाईं उड़ेंगे, वे दौड़ेंगे और श्रमित न होंगे, चलेंगे और थकित न होंगे॥', 'HINOVBSI'),
  ('5f3fc43e-cdaa-4bf5-849e-b79834150da0', 'Psalm 23:1', 'hi', 'यहोवा मेरा चरवाहा है, मुझे कुछ घटी न होगी।', 'HINOVBSI'),
  ('5f3fc43e-cdaa-4bf5-849e-b79834150da0', 'Philippians 4:13', 'hi', 'जो मुझे सामर्थ देता है उस में मैं सब कुछ कर सकता हूं।', 'HINOVBSI'),
  ('5f3fc43e-cdaa-4bf5-849e-b79834150da0', 'Proverbs 3:5', 'hi', 'तू अपनी समझ का सहारा न लेना, वरन सम्पूर्ण मन से यहोवा पर भरोसा रखना।', 'HINOVBSI')
on conflict (user_id, reference, language) do nothing;

commit;

-- verify (optional): 16 demo passages grouped by language
--   select p.language, count(*)
--     from public.passages p
--    where p.user_id = '5f3fc43e-cdaa-4bf5-849e-b79834150da0'
--    group by p.language order by p.language;
