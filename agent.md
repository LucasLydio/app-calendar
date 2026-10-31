# Project Agent Context

## 1. Project Overview & Architecture

Daybook is a serverless appointment-management and booking MVP. The deployed production stack is Netlify Static Hosting plus Netlify Functions, with Supabase Postgres as the database.

The deployed architecture is:

- **Frontend:** static `index.html` management interface, `book.html` public booking page, `time.html` availability-management page, and `services.html` service-management page. Admin pages use a responsive sticky top navigation bar with Appointments, Availability, and Services links; the public booking page intentionally has no navigation or header controls. Shared tokens and dashboard styles are in `styles.css`; page behavior/styles are split into root-level CSS and JavaScript files. `service-worker.js` supports browser push notifications.
- **Backend:** ES-module Netlify Functions in `netlify/functions/`, bundled by esbuild. `netlify.toml` maps public `/api/*` paths to function endpoints and serves the static site from `public/`.
- **Database:** Supabase Postgres accessed through Drizzle ORM and the `postgres` (postgres.js) driver.
- **Legacy/local server:** `server.js` and `calendar_worker.js` are retained for local/legacy development. Netlify publishes the static pages and functions; do not assume the Express server is the deployed API.
- **Other project surfaces:** `mcp_server.js` exposes appointment tools over the Model Context Protocol; `scripts/build.mjs` copies static assets into `public/`.

Keep deployed functions and the legacy Express implementation distinct unless a task explicitly requires both to change.

## 2. Tech Stack & Core Dependencies

- **Frontend:** Vanilla HTML/CSS/JavaScript; static pages are `index.html`, `book.html`, `time.html`, and `services.html`; service worker is `service-worker.js`.
- **Backend:** Netlify Functions (`netlify/functions/*.mjs`) using ES-module default exports and Web `Request`/`Response` APIs.
- **Database/ORM:** Supabase Postgres, `drizzle-orm/postgres-js`, `postgres` (postgres.js), schema in `db/schema.ts`.
- **Migration tooling:** `drizzle-kit`, config in `drizzle.config.ts`; generated migrations are under `drizzle/`.
- **Notifications:** Web Push via `web-push` and VAPID credentials; subscription storage is in Postgres.
- **Calendar:** ICS generation in `netlify/functions/lib/calendar.mjs`; Google Calendar event synchronization is handled through a Postgres outbox and the scheduled `calendar-sync` function.
- **Other dependencies:** `express` supports the legacy local server; `@modelcontextprotocol/sdk` supports `mcp_server.js`.

Useful package commands:

- `npm run build`: copies static files to `public/`.
- `npm run dev`: starts the legacy `server.js` app.
- `npx netlify dev`: runs the deployed Netlify site/functions locally when the Netlify CLI is available.
- `npx drizzle-kit generate`: generate migrations after changing `db/schema.ts`.
- `npx drizzle-kit migrate`: apply migrations using `MIGRATION_DATABASE_URL` when set, otherwise `DATABASE_URL`.

## 3. Database Configuration & Connection Rules (Critical)

### Supabase connections

The deployed app uses Supabase's **transaction-mode pooler** on port `6543`. In `db/index.ts`, keep these postgres.js settings:

- `prepare: false`: required for the transaction pooler.
- `ssl: 'require'`: TLS for Supabase external connections.
- `max: 1`: constrain per-instance connections in serverless.
- Current additional limits are `idle_timeout: 20` and `connect_timeout: 10`.

`DATABASE_URL` must be configured in Netlify for Functions and in local `.env`. Do not commit credentials. The current client logs if `DATABASE_URL` is absent and falls back to a deliberately invalid local URL so importing the module itself does not throw; actual DB queries will still fail. Never treat this fallback as a valid connection.

Drizzle migrations need a session-capable connection for migration locking. Set local `MIGRATION_DATABASE_URL` to Supabase's session-mode pooler connection (typically port `5432`) for CLI migrations. `drizzle.config.ts` prefers `MIGRATION_DATABASE_URL` and falls back to `DATABASE_URL`. If network access or the pooler prevents CLI migration, review and apply generated SQL with Supabase SQL Editor. Verify tables in the intended Supabase project after applying; generating a migration does not apply it remotely.

### Drizzle files

- `db/index.ts`: singleton postgres.js client and `drizzle(client, { schema })` export.
- `db/schema.ts`: PostgreSQL tables, typed columns, constraints, and indexes.
- `drizzle.config.ts`: PostgreSQL dialect; schema `./db/schema.ts`; output `./drizzle`; dotenv loaded for local CLI use.
- `drizzle/`: generated migration SQL and Drizzle metadata.
- `supabase/seed.sql`: idempotent seed for initial default availability; it does not create schema tables.

### Tables

- `availability`: singleton row (`singleton_id = 1`), IANA time zone, JSON weekly slots, update timestamp. Each weekly slot uses `{ "day": "Monday", "active": true, "start": "09:00", "end": "17:00", "blackoutSlots": ["12:00-13:00", "15:00-15:30"] }`. Blocked slots are independent exclusions within operating hours. All seven days are represented; inactive days remain stored with `active: false`. The function normalizes legacy short day keys and the former `blackout` field on read.
- `date_specific_exceptions`: one-off unavailable windows with UUID, singleton owner ID (`default` until manager authentication exists), exception date, start/end times, and timestamps. A user/date index supports booking lookups. These exceptions take absolute priority over recurring `weeklySlots` and recurring `blackoutSlots`.
- `services`: offerable service catalog with UUID, name, integer `price_cents`, positive `duration_minutes`, and creation timestamp. Currency is persisted as cents to avoid floating-point storage errors; the API exposes decimal-dollar `price` and integer `priceCents` values. Services are currently managed independently and are not connected to public appointment booking.
- `appointments`: customer and user IDs, legacy service label, nullable `service_id` foreign key, immutable service snapshots (`service_name`, `service_price` in cents, and `service_duration` in minutes), date/time, status (`pending`, `approved`, `rejected`), calendar-sync state/error/event metadata, and decision/creation timestamps. New public bookings populate every service field. Snapshot/FK columns remain nullable so legacy rows migrate without fabricated pricing; deleting a service sets only `service_id` to null and preserves snapshots. Active appointments have a partial unique index on date/time, while the booking transaction also serializes each date and rejects duration overlaps.
- `push_subscriptions`: one row per browser subscription with a SHA-256 browser ID, unique HTTPS push endpoint, JSON Web Push keys (`p256dh`, `auth`), stable browser-scoped user ID, and timestamps. Endpoint/key material is sensitive and remains server-side.
- `appointment_push_subscriptions`: normalized appointment-to-browser association with composite primary key `(appointment_id, browser_id)`. Both foreign keys cascade on deletion so expired endpoints and deleted appointments clean up their mappings.
- `calendar_outbox`: queued calendar actions with status, attempts, retry time, lock, error, event ID, and appointment foreign key.

## 4. API Endpoints & Routing

Routes are configured in `netlify.toml`. Netlify function handlers use ES-module default exports; do not mix V1 `exports.handler` syntax into these functions. JSON routes use helpers in `netlify/functions/lib/http.mjs`. Server errors are logged with nested causes and return a generic public message; avoid exposing SQL, credentials, or internal exception details to callers.

- **`GET /api/health`** -> `health.mjs`; does not access the database. Returns `{"status":"ok"}`.
- **`GET /api/availability`** -> returns `{"availability":{"timeZone":"...","weeklySlots":[],"dateSpecificExceptions":[],"disabledDates":[],"blackoutHours":[]}}`; array fields are always defined. If no availability row exists it returns all seven days with UTC weekdays active from 09:00–17:00.
- **`POST|PUT /api/availability`** -> body `{ "timeZone": "Area/Location", "weeklySlots": [{"day":"Monday","active":true,"start":"09:00","end":"17:00","blackoutSlots":["12:00-13:00"]}], "dateSpecificExceptions": [{"date":"2026-11-03","start":"13:00","end":"14:00"}] }`; validates the IANA timezone, recurring schedule, and non-overlapping one-off exceptions, then transactionally replaces the singleton schedule and exception rows. Legacy short weekday keys and stored `blackout` arrays remain accepted during transition.
- **`GET /time`** -> serves `time.html`, the manager availability editor. The build copies `time.html`, `time.css`, and `time.js` into `public/`.
- **`GET /services`** -> serves `services.html`, the standalone manager service catalog. The build copies `services.html`, `services.css`, and `services.js` into `public/`.
- **`GET /api/services`** -> returns `{ "services": [{ "id": "uuid", "name": "Hair Cut", "price": 30, "priceCents": 3000, "durationMinutes": 30, "createdAt": "..." }] }`, newest first; an empty catalog returns `services: []`.
- **`POST /api/services`** -> body `{ "name": "Hair Cut", "price": 30.00, "durationMinutes": 30 }`; validates values and returns `{ "service": {...} }` with HTTP 201.
- **`PUT /api/services?id=<uuid>`** -> replaces the editable name, price, and duration fields and returns `{ "service": {...} }`; returns 404 when the service does not exist.
- **`DELETE /api/services?id=<uuid>`** -> deletes one service and returns `{ "deleted": true, "id": "uuid" }`; returns 404 when the service does not exist.
- **`GET /api/appointments?status=pending|approved|rejected|all`** -> returns `{ "appointments": [...] }`; status defaults to `pending`. This is a manager-facing listing and must not be publicly exposed without manager authentication.
- **`GET /api/appointments?ids=<comma-separated IDs>`** -> returns a privacy-reduced batch of appointment ID, service name, date, time, status, and optional rejection message. The booking page uses it to refresh up to 50 locally saved appointments.
- **`GET /api/appointments?view=slots&date=YYYY-MM-DD&serviceId=<uuid>`** (also accepts `?date=YYYY-MM-DD`) -> always returns `{ "bookedSlots": ["HH:mm", ...], "bookedIntervals": [{ "time": "HH:mm", "durationMinutes": 30 }] }` for pending/approved bookings, including empty arrays when none exist. `bookedSlots` remains for backward compatibility; the public client uses intervals to prevent duration overlaps.
- **`POST /api/appointments`** -> booking body requires `{ "serviceId": "uuid", "name": "...", "email": "...", "date": "YYYY-MM-DD", "time": "HH:mm" }`; optional `userId`. The handler verifies the service, validates the complete service-duration window against weekly hours and exceptions, serializes bookings for that date, rejects overlaps, and snapshots the service name, price in cents, and duration. Returns `{ "appointment": {...}, "userId": "..." }` with HTTP 201.
- **`POST /api/appointments/:id/approve`** -> marks a pending appointment approved and queues a calendar outbox job; response includes appointment, `calendarSync: "queued"`, and push queue status. The function also accepts its rewritten `id` and `action` query parameters.
- **`POST /api/appointments/:id/reject`** -> optional body `{ "reason": "..." }`; marks a pending appointment rejected and returns the appointment and push queue status.
- **`GET /api/appointments/:id/ics`** -> returns an ICS file for approved appointments; the function receives the appointment ID in the `id` query parameter after rewrite.
- **`GET /api/push`** -> returns `{ "publicKey": "..." }` when VAPID is configured.
- **`POST /api/push`** -> body `{ "userId": "...", "appointmentId": "apt-...", "subscription": { "endpoint": "https://...", "keys": { "p256dh": "...", "auth": "..." } } }`; verifies appointment ownership, upserts the browser subscription, associates it with the appointment, and returns HTTP 201.
- **Internal `POST /.netlify/functions/push-notification-background`** -> requires `x-internal-function-token`; body contains `{ "appointment": {...}, "status": "approved|rejected", "message": "optional admin message" }`. Not a public application API.
- **Scheduled `calendar-sync` function** -> runs each minute on published deploys; processes due outbox entries and syncs approved appointments with Google Calendar.

**Security warning:** The existing project documentation notes that manager listing, approval/rejection, availability updates, and service CRUD do not currently authenticate callers. Do not treat these endpoints as secure manager APIs or expose them to untrusted production traffic until authorization is implemented and tested.

## 5. Design System & UI Tokens

The shared color tokens currently appear in inline styles in both HTML pages:

- `--sapphire: #4059adff`
- `--blue-grey: #6b9ac4ff`
- `--pearl-aqua: #97d8c4ff`
- `--platinum: #eff2f1ff`
- `--sunflower-gold: #f4b942ff`

Semantic aliases include `--color-lighter`, `--color-light`, `--color-medium`, `--color-dark`, and `--color-accent`. Spacing tokens include `--space-sm`, `--space-md`, `--space-lg`, and `--space-xlg`; shadow tokens range from `--shadow-lighter` to `--shadow-dark`.

Maintain the sharp-edged visual language: use `border-radius: 0` to `2px` (existing main controls use `0`). If extracting styles later, preserve token values and visual behavior across both pages.

## 6. Environment Variables & Secrets

Set local variables in ignored `.env`; configure deployed runtime values in **Netlify Dashboard > Site configuration > Environment variables**, scoped to Functions as appropriate. `.env.example` contains placeholders only.

Important keys:

- `DATABASE_URL`: Supabase transaction-mode pooler URL (port `6543`).
- `MIGRATION_DATABASE_URL`: local Drizzle migration connection, preferably Supabase session-mode pooler (port `5432`).
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: Web Push. Public/private keys must be a matching VAPID pair; only the public key is returned to clients. Keep the private key in Netlify Functions secrets. `VAPID_SUBJECT` should be a valid `mailto:` or HTTPS contact URI.
- `INTERNAL_FUNCTION_TOKEN`: protects internal push dispatch.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`: Google Calendar integration.
- `CALENDAR_APPOINTMENT_DURATION_MINUTES`, `CALENDAR_WORKER_MAX_ATTEMPTS`: optional worker settings with code/config defaults.

Never hardcode or commit secret values, include them in logs, or copy values from `.env` into documentation. Rotate any credentials accidentally exposed in conversation, source control, or build logs, then update Netlify and redeploy. Percent-encode reserved/non-ASCII characters in database URL passwords.

## 7. Recent Decisions & Current Status

### Implemented

- Netlify DB adapter was removed in favor of Supabase Postgres, Drizzle ORM, and postgres.js.
- The former admin sidebar was replaced by a sharp-edged, sticky top navigation bar on `index.html`, `time.html`, and `services.html`; all three admin pages expose Appointments, Availability, and Services. `book.html` remains an isolated client booking flow without navigation.
- Service CRUD is implemented through `services.html` and `netlify/functions/services.mjs`. The public `book.html` flow now loads this catalog first, keeps date/time controls disabled until a service is selected, and calculates availability using the selected duration on a 30-minute start grid. The public page remains isolated from admin navigation.
- `book.html` stores device-local booking history under the exact `localStorage` key `my_appointments` as a JSON array of `{ "appointmentId", "serviceName", "date", "time", "status", "message?" }`. Guarded reads/writes prevent storage or parsing failures from breaking booking. Database state remains authoritative and refreshes this history through the batch IDs endpoint.
- Push permission is requested only from the explicit **Enable status notifications** history action. Once granted, the client registers the root service worker, obtains the public VAPID key from `/api/push`, and associates the subscription with every locally saved appointment. Admin approve/reject actions queue background delivery; push-gateway 404/410 responses retire expired endpoints.
- Transaction-pooler compatibility guards are in `db/index.ts` (`prepare: false`, SSL required, one connection); client timeouts are configured.
- Drizzle migration config and generated SQL are in place; migration CLI prefers `MIGRATION_DATABASE_URL`.
- Netlify handlers use ES module default exports. Shared error handling logs server-side causes and returns safe JSON errors.
- `/api/health` is wired to a database-independent function.
- Availability GET has an empty-table default; `supabase/seed.sql` seeds the initial schedule.
- Approval/rejection handler accepts both rewritten query parameters and the public path form.
- Sharp-edged color system and VAPID push flow are present.

### Not yet verified / next steps

- **Remote database:** earlier local attempts to reach Supabase pooler ports timed out. Do not assume generated migrations or the seed have been applied. Verify all seven tables in the intended Supabase project; apply `drizzle/0000_silky_angel.sql`, `drizzle/0001_luxuriant_lilith.sql`, `drizzle/0002_hard_chat.sql`, `drizzle/0003_lowly_colonel_america.sql`, `drizzle/0004_lovely_shinko_yamashiro.sql`, and `supabase/seed.sql` where needed.
- **Production endpoints:** after deploy, test `/api/health`, `/api/availability`, public booking in `book.html`, appointment listing/actions only after authorization is addressed, and push subscription/delivery.
- **Push:** test subscription and notifications across supported browsers; verify VAPID values and the internal dispatch token in Netlify.
- **Calendar outbox:** scheduled worker is configured once per minute; verify actual retries and successful Google Calendar sync in production.
- **Availability UI:** `/time` includes a dedicated One-Off Exceptions list below “Select a Date and Time (Set unavailable).” Verify custom day hours, recurring blackout periods, date-specific exceptions, direct navigation, and narrow-screen layouts against the deployed database.
- **Authorization:** implement and test manager authentication before relying on manager endpoints in production.

For production diagnostics, use **Netlify Dashboard > Functions > [function name] > Logs**. Confirm that environment-variable edits are followed by a new deploy.
