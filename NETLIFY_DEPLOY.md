# Netlify deployment

## Netlify Database

Install `@netlify/database` and connect the site to Netlify Database. Netlify
provisions the database and supplies the connection to the native Drizzle
adapter, including isolated branches for deploy previews. Do not configure a
separate `DATABASE_URL` or run manual database migrations.

Drizzle schema migrations are generated into
`netlify/database/migrations` and applied automatically by Netlify during
deploys. Change the schema in `db/schema.ts`, then generate migration files with
`npx drizzle-kit generate`; do not run `drizzle-kit push` or a manual migrator.

## Required environment variables

In Netlify, open **Site configuration > Environment variables** (sometimes shown as **Site settings > Environment variables**) and add the following variables. Set their scope to **Functions**; add **Builds** only if a build step needs a variable. Do not put secret values in `netlify.toml` or commit them:

- `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`: Web Push VAPID key pair.
- `INTERNAL_FUNCTION_TOKEN`: long random secret used to authorize the internal push-background invocation.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`: Google Calendar OAuth credentials.

Optional values and defaults are in `netlify.toml`. `GOOGLE_CALENDAR_ID` defaults to `primary` and appointment duration defaults to 60 minutes.

For CLI setup, link the local repository with `netlify link`, then use `netlify env:set KEY VALUE --scope functions --context production --secret` for secret values. Avoid placing literal secret values in scripts, committed files, or shared terminal transcripts. You can also import a local dotenv file with `netlify env:import .env.local`; the file is ignored by Git, but verify the imported values and scopes in the Netlify dashboard.

After changing environment variables, trigger a new deploy so the deployed functions receive the updated values. Function code reads them using `process.env.*`; Netlify configuration-file environment values are build-time only and are not injected into function runtime.

## Initialize and run

1. Connect Netlify Database to the site in the Netlify UI.
2. Set the required function environment variables for the Netlify site.
3. Test locally with `npx netlify dev`.
4. Deploy with the Netlify CLI or connect the repository in Netlify. Netlify automatically applies migrations before publishing; the build runs `npm run build`, publishes `public/`, and packages `netlify/functions/`.

The scheduled `calendar-sync` function runs once per minute on published deploys. Deploy Previews do not run schedules automatically; invoke the function manually for preview testing.

Appointments, subscriptions, availability, and sync jobs now live in Postgres in the Netlify deployment. Existing local in-memory seed appointments are not copied by the migration. Export/import any real data before deployment if needed. `server.js` and `calendar_worker.js` remain the legacy local-development implementation; Netlify publishes the static files and `netlify/functions/` only.

## Production security requirement

The original MVP has no manager login, and the manager UI/API currently does not authenticate callers. Do not expose manager appointment listing, approval/rejection, or availability updates to production traffic until a Netlify-compatible identity provider is integrated and those routes validate manager authorization. The public booking endpoint only needs to expose availability and occupied time values; do not make customer names or email addresses public.
