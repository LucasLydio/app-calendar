import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publishDir = path.join(root, 'public');

await rm(publishDir, { recursive: true, force: true });
await mkdir(publishDir, { recursive: true });
for (const file of [
  'index.html',
  'styles.css',
  'script.js',
  'book.html',
  'book.css',
  'book.js',
  'time.html',
  'time.css',
  'time.js',
  'services.html',
  'services.css',
  'services.js',
  'service-worker.js',
  '_redirects',
]) {
  await cp(path.join(root, file), path.join(publishDir, file));
}
const supabaseUrl =
  process.env.SUPABASE_URL || 'https://ywbgrnbkvuiftcfhzhjz.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
await writeFile(
  path.join(publishDir, 'realtime-config.js'),
  `window.__DAYBOOK_PUBLIC_CONFIG__ = Object.freeze(${JSON.stringify({
    supabaseUrl,
    supabaseAnonKey,
  })});\n`,
  'utf8',
);
if (!supabaseAnonKey) {
  console.warn(
    'SUPABASE_ANON_KEY is not set; the dashboard will use REST without Realtime.',
  );
}
console.log('Copied static frontend files to public/.');
