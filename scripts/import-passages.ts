/**
 * Import verses from a JSON file into the `passages` table.
 *
 * The JSON is an array of objects: { reference, language, text, source?, metadata? }.
 * `direction` is derived by the DB; `cards` rows are created by the
 * `passages_create_card` trigger — this script only writes `passages`.
 *
 * Requires: npm i @supabase/supabase-js
 *
 * Usage:
 *   SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   IMPORT_USER_ID=<auth.users uuid> \
 *   npx tsx scripts/import-passages.ts ./verses.json
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

import { createClient } from '@supabase/supabase-js';

interface ImportRow {
  reference: string;
  language: string;
  text: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

const file = process.argv[2];
if (!file) throw new Error('usage: tsx scripts/import-passages.ts <verses.json>');

const rows = JSON.parse(readFileSync(file, 'utf8')) as ImportRow[];
if (!Array.isArray(rows)) throw new Error('expected the JSON file to contain an array');

const userId = requireEnv('IMPORT_USER_ID');
const supabase = createClient(
  requireEnv('SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

const payload = rows.map((row, i) => {
  if (!row.reference || !row.language || !row.text) {
    throw new Error(`row ${i} is missing reference, language, or text`);
  }
  return {
    user_id: userId,
    reference: row.reference.trim(),
    language: row.language.trim(),
    text: row.text.trim(),
    source: row.source?.trim() ?? null,
    metadata: row.metadata ?? {},
  };
});

const { error, count } = await supabase
  .from('passages')
  .upsert(payload, { onConflict: 'user_id,reference,language', count: 'exact' });

if (error) {
  console.error(error);
  process.exit(1);
}

console.log(`imported ${count ?? payload.length} passages; cards created by trigger`);
