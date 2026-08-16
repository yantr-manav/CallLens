// Applies supabase/migrations/*.sql to the live Supabase database.
//
// Reads DATABASE_URL from .env (postgresql+asyncpg:// format), converts it to
// a standard postgresql:// URL for the `pg` driver, and executes the SQL
// files in order. Never prints connection secrets.
//
// Usage: node scripts/migrate-supabase.mjs
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || line.trimStart().startsWith('#')) continue;
      out[m[1]] = m[2];
    }
  } catch {
    // missing file → empty
  }
  return out;
}

const env = { ...loadDotEnv(path.join(root, '.env')), ...process.env };
const rawUrl = env.DATABASE_URL;
if (!rawUrl) {
  console.error('DATABASE_URL not found in .env. Add it first.');
  process.exit(1);
}

// asyncpg driver prefix (SQLAlchemy) → plain postgresql:// for `pg`
const url = rawUrl.replace('postgresql+asyncpg://', 'postgresql://');
const masked = url.replace(/:[^:@/]+@/, ':***@');

const migrationsDir = path.join(root, 'supabase', 'migrations');
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

console.log(`applying ${files.length} migration(s) to ${masked}`);

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    await client.query(sql);
    console.log(`  ✓ ${file}`);
  }

  const tables = await client.query(
    `select table_name from information_schema.tables
     where table_schema='public' and table_name in ('profiles','conversations','analyses','sentences')
     order by table_name`
  );
  console.log('tables present:', tables.rows.map((r) => r.table_name).join(', '));

  const buckets = await client.query(
    `select id, public from storage.buckets where id = 'transcripts'`
  );
  console.log('storage bucket:', buckets.rows.length ? JSON.stringify(buckets.rows[0]) : 'MISSING');

  const rls = await client.query(
    `select tablename, rowsecurity from pg_tables
     where schemaname='public' and tablename in ('profiles','conversations','analyses','sentences')
     order by tablename`
  );
  console.log(
    'rls:',
    rls.rows.map((r) => `${r.tablename}=${r.rowsecurity ? 'on' : 'OFF'}`).join(' ')
  );
} finally {
  await client.end();
}
console.log('done.');