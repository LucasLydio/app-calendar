'use strict';

const crypto = require('node:crypto');

const GOOGLE_API_BASE_URL = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

class CalendarIntegrationError extends Error {
  constructor(message, { transient = false, status } = {}) {
    super(message);
    this.name = 'CalendarIntegrationError';
    this.transient = transient;
    this.status = status;
  }
}

function deterministicEventId(appointmentId) {
  return crypto.createHash('sha256').update(appointmentId).digest('hex');
}

function getAppointmentDateTimes(appointment, durationMinutes) {
  const start = new Date(`${appointment.date}T${appointment.time}:00Z`);
  if (Number.isNaN(start.getTime())) {
    throw new CalendarIntegrationError(
      'Appointment has an invalid date or time.',
    );
  }

  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const toLocalDateTime = (date) => date.toISOString().slice(0, 19);

  return { start: toLocalDateTime(start), end: toLocalDateTime(end) };
}

function buildGoogleEventPayload(
  appointment,
  timeZone = 'UTC',
  durationMinutes = 60,
) {
  const { start, end } = getAppointmentDateTimes(appointment, durationMinutes);

  return {
    id: deterministicEventId(appointment.id),
    summary: `${appointment.service} - ${appointment.name}`,
    description: `Appointment for ${appointment.name} (${appointment.email}).`,
    start: { dateTime: start, timeZone },
    end: { dateTime: end, timeZone },
    attendees: [{ email: appointment.email }],
  };
}

async function getGoogleAccessToken() {
  const configuredValues = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REFRESH_TOKEN,
  ];

  if (configuredValues.some((value) => !value)) {
    throw new CalendarIntegrationError(
      'Google Calendar OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.',
    );
  }

  let response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
  } catch (error) {
    throw new CalendarIntegrationError(
      `Could not reach Google OAuth: ${error.message}`,
      { transient: true },
    );
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new CalendarIntegrationError(
      payload.error_description ||
        payload.error ||
        'Google OAuth token request failed.',
      {
        transient:
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
        status: response.status,
      },
    );
  }

  return payload.access_token;
}

async function readGoogleResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload.error?.message ||
      `Google Calendar returned HTTP ${response.status}.`;
    throw new CalendarIntegrationError(message, {
      transient:
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500,
      status: response.status,
    });
  }
  return payload;
}

async function syncGoogleEvent(appointment, options = {}) {
  const accessToken = await (options.getAccessToken || getGoogleAccessToken)();
  const calendarId = encodeURIComponent(
    process.env.GOOGLE_CALENDAR_ID || 'primary',
  );
  const eventId = deterministicEventId(appointment.id);
  const eventUrl = `${GOOGLE_API_BASE_URL}/calendars/${calendarId}/events/${eventId}`;

  let existingResponse;
  try {
    existingResponse = await fetch(eventUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (error) {
    throw new CalendarIntegrationError(
      `Could not reach Google Calendar: ${error.message}`,
      { transient: true },
    );
  }

  if (existingResponse.ok) {
    return readGoogleResponse(existingResponse);
  }
  if (existingResponse.status !== 404) {
    return readGoogleResponse(existingResponse);
  }

  const payload = buildGoogleEventPayload(
    appointment,
    options.timeZone || 'UTC',
    options.durationMinutes || 60,
  );
  let insertResponse;
  try {
    insertResponse = await fetch(
      `${GOOGLE_API_BASE_URL}/calendars/${calendarId}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );
  } catch (error) {
    throw new CalendarIntegrationError(
      `Could not reach Google Calendar: ${error.message}`,
      { transient: true },
    );
  }

  // The deterministic Google event ID makes a duplicate insert a successful retry.
  if (insertResponse.status === 409) {
    return { id: eventId, alreadyExists: true };
  }
  return readGoogleResponse(insertResponse);
}

function escapeIcsText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function toUtcIcsDateTime(localDateTime, timeZone) {
  const [datePart, timePart] = localDateTime.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  const desiredUtcValue = Date.UTC(year, month - 1, day, hour, minute, second);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let candidate = desiredUtcValue;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    const representedUtcValue = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate += desiredUtcValue - representedUtcValue;
  }

  return new Date(candidate)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function foldIcsLine(line) {
  const folded = [];
  let current = '';
  let byteLength = 0;

  for (const character of line) {
    const characterBytes = Buffer.byteLength(character);
    if (byteLength + characterBytes > 75) {
      folded.push(current);
      current = ` ${character}`;
      byteLength = 1 + characterBytes;
    } else {
      current += character;
      byteLength += characterBytes;
    }
  }

  folded.push(current);
  return folded.join('\r\n');
}

function buildIcsCalendar(
  appointment,
  { timeZone = 'UTC', durationMinutes = 60 } = {},
) {
  const { start, end } = getAppointmentDateTimes(appointment, durationMinutes);
  const uid = `${deterministicEventId(appointment.id)}@app-calendar`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Appointment Manager//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z')}`,
    `DTSTART:${toUtcIcsDateTime(start, timeZone)}`,
    `DTEND:${toUtcIcsDateTime(end, timeZone)}`,
    `SUMMARY:${escapeIcsText(`${appointment.service} - ${appointment.name}`)}`,
    `DESCRIPTION:${escapeIcsText(`Appointment for ${appointment.name} (${appointment.email}).`)}`,
    `ATTENDEE;CN=${escapeIcsText(appointment.name)}:mailto:${appointment.email}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

function createCalendarWorker({
  appointments,
  calendarSyncOutbox,
  getTimeZone = () => 'UTC',
  syncEvent = syncGoogleEvent,
  intervalMs = Number(process.env.CALENDAR_WORKER_INTERVAL_MS) || 7000,
  maxAttempts = Number(process.env.CALENDAR_WORKER_MAX_ATTEMPTS) || 5,
  retryBaseMs = Number(process.env.CALENDAR_WORKER_RETRY_BASE_MS) || 5000,
  durationMinutes = Number(process.env.CALENDAR_APPOINTMENT_DURATION_MINUTES) ||
    60,
}) {
  let timer;
  let isProcessing = false;

  async function processJob(job) {
    const appointment = appointments.find(
      (item) => item.id === job.appointmentId,
    );
    if (!appointment || appointment.status !== 'approved') {
      job.status = 'failed';
      job.lastError = appointment
        ? 'Calendar sync is only allowed for approved appointments.'
        : 'Appointment not found.';
      job.completedAt = new Date().toISOString();
      if (appointment) {
        appointment.calendarSyncStatus = 'failed';
        appointment.calendarSyncError = job.lastError;
      }
      return;
    }

    job.status = 'processing';
    job.attempts = (job.attempts || 0) + 1;
    appointment.calendarSyncStatus = 'pending';

    try {
      const event = await syncEvent(appointment, {
        timeZone: getTimeZone(),
        durationMinutes,
      });
      job.status = 'synced';
      job.completedAt = new Date().toISOString();
      job.googleEventId = event.id || deterministicEventId(appointment.id);
      delete job.lastError;
      delete job.nextAttemptAt;
      appointment.calendarSyncStatus = 'synced';
      appointment.calendarSyncedAt = job.completedAt;
      appointment.googleEventId = job.googleEventId;
      delete appointment.calendarSyncError;
    } catch (error) {
      job.lastError = error.message || 'Calendar sync failed.';
      const transient = error.transient === true || error.name === 'TypeError';

      if (transient && job.attempts < maxAttempts) {
        job.status = 'pending';
        job.nextAttemptAt = new Date(
          Date.now() + retryBaseMs * 2 ** (job.attempts - 1),
        ).toISOString();
        appointment.calendarSyncStatus = 'pending';
      } else {
        job.status = 'failed';
        job.completedAt = new Date().toISOString();
        appointment.calendarSyncStatus = 'failed';
        appointment.calendarSyncError = job.lastError;
      }
      console.error(
        `Calendar sync attempt ${job.attempts} failed for ${appointment.id}: ${job.lastError}`,
      );
    }
  }

  async function processPendingJobs() {
    if (isProcessing) return;
    isProcessing = true;
    try {
      const now = Date.now();
      const pendingJobs = calendarSyncOutbox.filter(
        (job) =>
          job.type === 'calendar.sync' &&
          job.status === 'pending' &&
          (!job.nextAttemptAt || Date.parse(job.nextAttemptAt) <= now),
      );
      await Promise.all(pendingJobs.map(processJob));
    } finally {
      isProcessing = false;
    }
  }

  function start() {
    if (timer) return;
    void processPendingJobs();
    timer = setInterval(() => {
      void processPendingJobs();
    }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  }

  return { start, stop, processPendingJobs };
}

module.exports = {
  buildGoogleEventPayload,
  buildIcsCalendar,
  createCalendarWorker,
  deterministicEventId,
  getGoogleAccessToken,
  syncGoogleEvent,
};
