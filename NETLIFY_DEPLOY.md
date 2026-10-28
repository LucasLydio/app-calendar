# Netlify deployment

## Required environment variables

Configure these in Netlify site settings or with `netlify env:set`; do not commit secret values:

- `DATABASE_URL`: Neon Postgres connection string.
- `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`: Web Push VAPID key pair.
- `INTERNAL_FUNCTION_TOKEN`: long random secret used to authorize the internal push-background invocation.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`: Google Calendar OAuth credentials.

Optional values and defaults are in `netlify.toml`. `GOOGLE_CALENDAR_ID` defaults to `primary` and appointment duration defaults to 60 minutes.

## Initialize and run

1. Create a Neon Postgres database and set `DATABASE_URL` locally without committing it.
2. Apply the schema once: `npm run db:migrate`.
3. Set the required environment variables for the Netlify site.
4. Test locally with `npx netlify dev`.
5. Deploy with the Netlify CLI or connect the repository in Netlify. The build runs `npm run build`, publishes `public/`, and packages `netlify/functions/`.

The scheduled `calendar-sync` function runs once per minute on published deploys. Deploy Previews do not run schedules automatically; invoke the function manually for preview testing.

Appointments, subscriptions, availability, and sync jobs now live in Postgres in the Netlify deployment. Existing local in-memory seed appointments are not copied by the migration. Export/import any real data before deployment if needed. `server.js` and `calendar_worker.js` remain the legacy local-development implementation; Netlify publishes the static files and `netlify/functions/` only.

## Production security requirement

The original MVP has no manager login, and the manager UI/API currently does not authenticate callers. Do not expose manager appointment listing, approval/rejection, or availability updates to production traffic until a Netlify-compatible identity provider is integrated and those routes validate manager authorization. The public booking endpoint only needs to expose availability and occupied time values; do not make customer names or email addresses public.
