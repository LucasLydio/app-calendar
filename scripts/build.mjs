import { cp, mkdir, rm } from 'node:fs/promises';
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
  'service-worker.js',
  '_redirects',
]) {
  await cp(path.join(root, file), path.join(publishDir, file));
}
console.log('Copied static frontend files to public/.');
