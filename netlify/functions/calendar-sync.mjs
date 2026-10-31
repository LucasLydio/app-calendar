import { sql } from 'drizzle-orm';
import { buildGoogleEventPayload, googleEventId } from './lib/calendar.mjs';
import { db, getAvailability } from './lib/db.mjs';

const BATCH_SIZE = 3;
const MAX_ATTEMPTS = Number(process.env.CALENDAR_WORKER_MAX_ATTEMPTS) || 5;
const LEASE_SECONDS = 1800;
const GOOGLE_API = 'https://www.googleapis.com/calendar/v3';

async function getAccessToken() {
  const values = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REFRESH_TOKEN,
  ];
  if (values.some((value) => !value)) {
    throw Object.assign(
      new Error('Google Calendar OAuth credentials are not configured.'),
      {
        transient: false,
      },
    );
  }
  let response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(7000),
    });
  } catch (error) {
    throw Object.assign(
      new Error(`Google OAuth request failed: ${error.message}`),
      {
        transient: true,
      },
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw Object.assign(
      new Error(
        payload.error_description ||
          payload.error ||
          `OAuth returned HTTP ${response.status}.`,
      ),
      {
        transient:
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
      },
    );
  }
  return payload.access_token;
}

function isTransientStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

async function syncGoogleAppointment(appointment, timeZone, accessToken) {
  const calendarId = encodeURIComponent(
    process.env.GOOGLE_CALENDAR_ID || 'primary',
  );
  const eventId = googleEventId(appointment.id);
  const base = `${GOOGLE_API}/calendars/${calendarId}/events`;
  const headers = { Authorization: `Bearer ${accessToken}` };
  let response;
  try {
    response = await fetch(`${base}/${eventId}`, {
      headers,
      signal: AbortSignal.timeout(7000),
    });
  } catch (error) {
    throw Object.assign(
      new Error(`Google Calendar lookup failed: ${error.message}`),
      {
        transient: true,
      },
    );
  }
  if (response.ok) return { id: eventId };
  if (response.status !== 404) {
    const payload = await response.json().catch(() => ({}));
    throw Object.assign(
      new Error(
        payload.error?.message ||
          `Google Calendar returned HTTP ${response.status}.`,
      ),
      {
        transient: isTransientStatus(response.status),
      },
    );
  }

  const event = buildGoogleEventPayload(
    appointment,
    timeZone,
    appointment.serviceDuration ||
      Number(process.env.CALENDAR_APPOINTMENT_DURATION_MINUTES) ||
      60,
  );
  try {
    response = await fetch(base, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(7000),
    });
  } catch (error) {
    throw Object.assign(
      new Error(`Google Calendar insert failed: ${error.message}`),
      {
        transient: true,
      },
    );
  }
  if (response.ok || response.status === 409) return { id: eventId };
  const payload = await response.json().catch(() => ({}));
  throw Object.assign(
    new Error(
      payload.error?.message ||
        `Google Calendar returned HTTP ${response.status}.`,
    ),
    {
      transient: isTransientStatus(response.status),
    },
  );
}

async function executeRows(query) {
  const result = await db.execute(query);
  return Array.isArray(result?.rows) ? result.rows : [];
}

async function claimJobs() {
  return executeRows(sql`
    WITH candidates AS (
      SELECT id
      FROM calendar_outbox
      WHERE (status = 'pending' AND next_attempt_at <= now())
         OR (status = 'processing' AND locked_until < now())
      ORDER BY created_at
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE calendar_outbox AS jobs
      SET status = 'processing', attempts = jobs.attempts + 1,
          locked_until = now() + (${LEASE_SECONDS} * interval '1 second')
      FROM candidates
      WHERE jobs.id = candidates.id
      RETURNING jobs.*
    )
    SELECT claimed.id AS job_id, claimed.attempts, claimed.appointment_id,
           appointments.id, appointments.user_id, appointments.customer_name,
           appointments.customer_email, appointments.service,
           appointments.service_duration,
           appointments.appointment_date, appointments.appointment_time,
           appointments.status AS appointment_status
    FROM claimed
    JOIN appointments ON appointments.id = claimed.appointment_id
  `);
}

function appointmentFromJob(row) {
  return {
    id: row.appointment_id,
    userId: row.user_id,
    name: row.customer_name,
    email: row.customer_email,
    service: row.service,
    serviceDuration: Number.isInteger(row.service_duration)
      ? row.service_duration
      : null,
    date: String(row.appointment_date).slice(0, 10),
    time: String(row.appointment_time).slice(0, 5),
    status: row.appointment_status,
  };
}

async function markSynced(job, appointment, eventId) {
  await executeRows(sql`
    WITH job_update AS (
      UPDATE calendar_outbox
      SET status = 'synced', google_event_id = ${eventId}, completed_at = now(),
          locked_until = NULL, last_error = NULL
      WHERE id = ${job.job_id}
    )
    UPDATE appointments
    SET calendar_sync_status = 'synced', google_event_id = ${eventId},
        calendar_synced_at = now(), calendar_sync_error = NULL
    WHERE id = ${appointment.id} AND status = 'approved'
  `);
}

async function markFailed(job, appointment, error) {
  const transient = error.transient === true;
  const retry = transient && job.attempts < MAX_ATTEMPTS;
  const delaySeconds = Math.min(3600, 30 * 2 ** Math.max(0, job.attempts - 1));
  const message = (error.message || 'Calendar sync failed.').slice(0, 1000);

  await executeRows(sql`
    WITH job_update AS (
      UPDATE calendar_outbox
      SET status = ${retry ? 'pending' : 'failed'},
          next_attempt_at = now() + (${delaySeconds} * interval '1 second'),
          locked_until = NULL, last_error = ${message},
          completed_at = ${retry ? null : new Date().toISOString()}
      WHERE id = ${job.job_id}
    )
    UPDATE appointments
    SET calendar_sync_status = ${retry ? 'pending' : 'failed'},
        calendar_sync_error = ${message}
    WHERE id = ${appointment.id} AND status = 'approved'
  `);
  console.error(
    `Calendar sync job ${job.job_id} failed on attempt ${job.attempts}: ${message}`,
  );
}

export default async function handler(_request, _context) {
  try {
    const claimedJobs = await claimJobs();
    const jobs = Array.isArray(claimedJobs) ? claimedJobs : [];
    if (jobs.length === 0) {
      console.log('Console: No pending calendar outbox items to process.');
      return new Response(JSON.stringify({ message: 'No items to sync' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const availability = await getAvailability();
    let accessToken;
    try {
      accessToken = await getAccessToken();
    } catch (error) {
      await Promise.all(
        jobs.map((job) => markFailed(job, appointmentFromJob(job), error)),
      );
      return new Response(
        JSON.stringify({
          message: `Processed ${jobs.length} calendar sync job(s).`,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    await Promise.all(
      jobs.map(async (job) => {
        const appointment = appointmentFromJob(job);
        if (appointment.status !== 'approved') {
          await markFailed(
            job,
            appointment,
            new Error('Only approved appointments can be synced.'),
          );
          return;
        }
        try {
          const event = await syncGoogleAppointment(
            appointment,
            availability.timeZone,
            accessToken,
          );
          await markSynced(job, appointment, event.id);
        } catch (error) {
          await markFailed(job, appointment, error);
        }
      }),
    );
    return new Response(
      JSON.stringify({
        message: `Processed ${jobs.length} calendar sync job(s).`,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('Scheduled calendar sync failed:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
