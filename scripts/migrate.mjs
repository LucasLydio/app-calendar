import { neon } from '@neondatabase/serverless';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL before running database migrations.');
  process.exitCode = 1;
} else {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const migration = await readFile(
    path.join(root, 'migrations/001_initial.sql'),
    'utf8',
  );
  const statements = migration
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  const sql = neon(process.env.DATABASE_URL);
  for (const statement of statements) {
    await sql.query(statement);
  }
  console.log('Database migration 001_initial.sql applied.');
}
