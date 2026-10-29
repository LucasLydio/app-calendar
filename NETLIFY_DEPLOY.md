# Netlify deployment

## Supabase Postgres

Create or use a Supabase Postgres project and configure `DATABASE_URL` with its
transaction-mode pooler URL (port `6543`). Set the same variable in the Netlify
Dashboard under **Site configuration > Environment variables**, scoped to
Functions. Keep the actual password out of committed files; `.env.example`
shows the expected URL format.

For local Drizzle migrations, set `MIGRATION_DATABASE_URL` in `.env` to the
Supabase session-mode pooler URL (port `5432`). Drizzle migrations need a
session-capable connection for migration locking; the app continues using
`DATABASE_URL` and its transaction-mode pooler. The config falls back to
`DATABASE_URL` if `MIGRATION_DATABASE_URL` is unset, but migration commands may
hang when run through transaction mode.

Drizzle schema migrations are generated into `drizzle/`. Change the schema in
`db/schema.ts`, then generate migration files with `npx drizzle-kit generate`.
Apply generated SQL to Supabase as part of deployment; Netlify does not apply
these migrations automatically.

## Required environment variables

In Netlify, open **Site configuration > Environment variables** (sometimes shown as **Site settings > Environment variables**) and add the following variables. Set their scope to **Functions**; add **Builds** only if a build step needs a variable. Do not put secret values in `netlify.toml` or commit them:

- `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`: Web Push VAPID key pair.
- `INTERNAL_FUNCTION_TOKEN`: long random secret used to authorize the internal push-background invocation.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`: Google Calendar OAuth credentials.
- `DATABASE_URL`: Supabase transaction-mode pooler connection string.

Optional values and defaults are in `netlify.toml`. `GOOGLE_CALENDAR_ID` defaults to `primary` and appointment duration defaults to 60 minutes.

For CLI setup, link the local repository with `netlify link`, then use `netlify env:set KEY VALUE --scope functions --context production --secret` for secret values. Avoid placing literal secret values in scripts, committed files, or shared terminal transcripts. You can also import a local dotenv file with `netlify env:import .env.local`; the file is ignored by Git, but verify the imported values and scopes in the Netlify dashboard.

After changing environment variables, trigger a new deploy so the deployed functions receive the updated values. Function code reads them using `process.env.*`; Netlify configuration-file environment values are build-time only and are not injected into function runtime.

## Initialize and run

1. Set the required function environment variables, including `DATABASE_URL`, for the Netlify site.
2. Apply pending SQL migrations to Supabase.
3. Test locally with `npx netlify dev`.
4. Deploy with the Netlify CLI or connect the repository in Netlify. The build runs `npm run build`, publishes `public/`, and packages `netlify/functions/`.

The scheduled `calendar-sync` function runs once per minute on published deploys. Deploy Previews do not run schedules automatically; invoke the function manually for preview testing.

Appointments, subscriptions, availability, and sync jobs live in Supabase Postgres. Export/import any real data before deployment if needed. `server.js` and `calendar_worker.js` remain the legacy local-development implementation; Netlify publishes the static files and `netlify/functions/` only.

## Production security requirement

The original MVP has no manager login, and the manager UI/API currently does not authenticate callers. Do not expose manager appointment listing, approval/rejection, or availability updates to production traffic until a Netlify-compatible identity provider is integrated and those routes validate manager authorization. The public booking endpoint only needs to expose availability and occupied time values; do not make customer names or email addresses public.
