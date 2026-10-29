import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString =
  process.env.DATABASE_URL ||
  'postgres://postgres:postgres@127.0.0.1:1/postgres';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is missing.');
}

const client = postgres(connectionString, {
  prepare: false,
  ssl: 'require',
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
