'use strict';

const crypto = require('node:crypto');
const express = require('express');
const path = require('node:path');
const webPush = require('web-push');
const { buildIcsCalendar, createCalendarWorker } = require('./calendar_worker');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const appointments = [
  {
    id: 'apt-1048',
    userId: 'user-001',
    name: 'Jordan Leeson',
    email: 'jordan.lee@example.com',
    service: 'Consultation',
    date: '2026-10-29',
    time: '10:30',
    status: 'pending',
  },
  {
    id: 'apt-1047',
    userId: 'user-002',
    name: 'Samira Patel',
    email: 'samira.patel@example.com',
    service: 'Project review',
    date: '2026-10-29',
    time: '13:00',
    status: 'pending',
  },
  {
    id: 'apt-1046',
    userId: 'user-003',
    name: 'Noah Williams',
    email: 'noah.williams@example.com',
    service: 'Initial meeting',
    date: '2026-10-30',
    time: '09:30',
    status: 'pending',
  },
  {
    id: 'apt-1045',
    userId: 'user-004',
    name: 'Mina Chen',
    email: 'mina.chen@example.com',
    service: 'Follow-up',
    date: '2026-11-02',
    time: '15:00',
    status: 'pending',
  },
];

let availability = {
  timeZone: 'UTC',
  weeklySlots: [
    { day: 'mon', start: '09:00', end: '17:00' },
    { day: 'tue', start: '09:00', end: '17:00' },
    { day: 'wed', start: '09:00', end: '17:00' },
    { day: 'thu', start: '09:00', end: '17:00' },
    { day: 'fri', start: '09:00', end: '17:00' },
  ],
};

const subscriptions = new Map();
const calendarSyncOutbox = [];
const calendarWorker = createCalendarWorker({
  appointments,
  calendarSyncOutbox,
  getTimeZone: () => availability.timeZone,
});

function configureVapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (Boolean(publicKey) !== Boolean(privateKey)) {
    throw new Error(
      'Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither.',
    );
  }

  if (publicKey && privateKey) {
    webPush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
      publicKey,
      privateKey,
    );
    return publicKey;
  }

  const temporaryKeys = webPush.generateVAPIDKeys();
  webPush.setVapidDetails(
    'mailto:admin@example.com',
    temporaryKeys.publicKey,
    temporaryKeys.privateKey,
  );
  console.warn(
    'Using temporary VAPID keys. Configure VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY for stable subscriptions.',
  );
  return temporaryKeys.publicKey;
}

const vapidPublicKey = configureVapid();

app.use(express.json({ limit: '32kb' }));

app.get('/', (_request, response) => {
  return response.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/service-worker.js', (_request, response) => {
  response.set('Service-Worker-Allowed', '/');
  return response.sendFile(path.join(__dirname, 'service-worker.js'));
});

app.get('/book', (_request, response) => {
  return response.sendFile(path.join(__dirname, 'book.html'));
});

app.get('/api/appointments', (request, response) => {
  const requestedStatus = request.query.status || 'pending';
  const allowedStatuses = new Set(['pending', 'approved', 'rejected', 'all']);

  if (!allowedStatuses.has(requestedStatus)) {
    return response
      .status(400)
      .json({ error: 'status must be pending, approved, rejected, or all.' });
  }

  const results =
    requestedStatus === 'all'
      ? appointments
      : appointments.filter(
          (appointment) => appointment.status === requestedStatus,
        );

  return response.status(200).json({ appointments: results });
});

app.post('/api/appointments', (request, response) => {
  const { name, email, date, time } = request.body || {};
  const requestedUserId = request.body?.userId;
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim() : '';
  const durationMinutes =
    Number(process.env.CALENDAR_APPOINTMENT_DURATION_MINUTES) || 60;
  const parsedDate =
    typeof date === 'string' ? new Date(`${date}T00:00:00.000Z`) : null;
  const isValidDate =
    parsedDate &&
    !Number.isNaN(parsedDate.getTime()) &&
    parsedDate.toISOString().slice(0, 10) === date;

  if (
    !normalizedName ||
    normalizedName.length > 120 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
    normalizedEmail.length > 254 ||
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !isValidDate ||
    typeof time !== 'string' ||
    !TIME_PATTERN.test(time)
  ) {
    return response.status(400).json({
      error:
        'name, valid email, date (YYYY-MM-DD), and time (HH:mm) are required.',
    });
  }

  if (
    requestedUserId !== undefined &&
    (typeof requestedUserId !== 'string' || !requestedUserId.trim())
  ) {
    return response
      .status(400)
      .json({ error: 'userId must be a non-empty string.' });
  }

  const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][
    new Date(`${date}T00:00:00.000Z`).getUTCDay()
  ];
  const requestedStart = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const isAvailable = availability.weeklySlots.some((slot) => {
    if (slot.day !== day) return false;
    const slotStart =
      Number(slot.start.slice(0, 2)) * 60 + Number(slot.start.slice(3));
    const slotEnd =
      Number(slot.end.slice(0, 2)) * 60 + Number(slot.end.slice(3));
    return (
      requestedStart >= slotStart &&
      requestedStart + durationMinutes <= slotEnd &&
      (requestedStart - slotStart) % durationMinutes === 0
    );
  });

  if (!isAvailable) {
    return response.status(409).json({
      error: 'That time is outside the configured appointment availability.',
    });
  }

  const currentDateTime = new Intl.DateTimeFormat('sv-SE', {
    timeZone: availability.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  const requestedDateTime = `${date} ${time}`;
  if (requestedDateTime <= currentDateTime) {
    return response.status(409).json({
      error: 'Appointments must be requested for a future date and time.',
    });
  }

  const requestedEnd = requestedStart + durationMinutes;
  const hasConflict = appointments.some((appointment) => {
    if (
      appointment.date !== date ||
      !['pending', 'approved'].includes(appointment.status)
    ) {
      return false;
    }
    const existingStart =
      Number(appointment.time.slice(0, 2)) * 60 +
      Number(appointment.time.slice(3));
    return (
      requestedStart < existingStart + durationMinutes &&
      existingStart < requestedEnd
    );
  });

  if (hasConflict) {
    return response.status(409).json({
      error: 'That time was just booked. Please choose another available time.',
    });
  }

  const userId = requestedUserId?.trim() || `user-${crypto.randomUUID()}`;
  const appointment = {
    id: `apt-${crypto.randomUUID()}`,
    userId,
    name: normalizedName,
    email: normalizedEmail,
    service: 'Consultation',
    date,
    time,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  appointments.push(appointment);

  return response.status(201).json({ appointment, userId });
});

app.get('/api/appointments/:id/ics', (request, response) => {
  const appointment = appointments.find(
    (item) => item.id === request.params.id,
  );
  if (!appointment) {
    return response.status(404).json({ error: 'Appointment not found.' });
  }
  if (appointment.status !== 'approved') {
    return response
      .status(409)
      .json({ error: 'Only approved appointments can be exported.' });
  }

  const calendar = buildIcsCalendar(appointment, {
    timeZone: availability.timeZone,
    durationMinutes:
      Number(process.env.CALENDAR_APPOINTMENT_DURATION_MINUTES) || 60,
  });
  const fileId = appointment.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  response.set({
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `attachment; filename="${fileId}.ics"`,
  });
  return response.status(200).send(calendar);
});

app.get('/api/availability', (_request, response) => {
  return response.status(200).json({ availability });
});

app.put('/api/availability', (request, response) => {
  const { timeZone, weeklySlots } = request.body || {};

  if (
    typeof timeZone !== 'string' ||
    !timeZone.trim() ||
    !Array.isArray(weeklySlots)
  ) {
    return response
      .status(400)
      .json({ error: 'timeZone and weeklySlots are required.' });
  }

  const slotsAreValid = weeklySlots.every(
    (slot) =>
      slot &&
      DAYS.has(slot.day) &&
      TIME_PATTERN.test(slot.start) &&
      TIME_PATTERN.test(slot.end) &&
      slot.start < slot.end,
  );

  if (!slotsAreValid) {
    return response.status(400).json({
      error:
        'Each slot needs a valid weekday and start/end times, with end after start.',
    });
  }

  availability = {
    timeZone: timeZone.trim(),
    weeklySlots: weeklySlots.map(({ day, start, end }) => ({
      day,
      start,
      end,
    })),
  };

  return response.status(200).json({ availability });
});

app.get('/api/push/vapid-public-key', (_request, response) => {
  return response.status(200).json({ publicKey: vapidPublicKey });
});

app.post('/api/push/subscriptions', (request, response) => {
  const { userId, subscription } = request.body || {};

  if (typeof userId !== 'string' || !userId.trim()) {
    return response.status(400).json({ error: 'userId is required.' });
  }

  if (
    !subscription ||
    typeof subscription.endpoint !== 'string' ||
    !subscription.endpoint.startsWith('https://') ||
    typeof subscription.keys?.p256dh !== 'string' ||
    typeof subscription.keys?.auth !== 'string'
  ) {
    return response
      .status(400)
      .json({ error: 'A valid Web Push subscription is required.' });
  }

  const subscriptionId = crypto
    .createHash('sha256')
    .update(subscription.endpoint)
    .digest('hex');
  const isNew = !subscriptions.has(subscription.endpoint);
  subscriptions.set(subscription.endpoint, {
    id: subscriptionId,
    userId: userId.trim(),
    subscription,
  });

  return response
    .status(isNew ? 201 : 200)
    .json({ id: subscriptionId, userId: userId.trim() });
});

async function notifyAppointmentUser(appointment, status) {
  const userSubscriptions = [...subscriptions.entries()].filter(
    ([, entry]) => entry.userId === appointment.userId,
  );
  const payload = JSON.stringify({
    title:
      status === 'approved' ? 'Appointment approved' : 'Appointment update',
    body:
      status === 'approved'
        ? `Your ${appointment.service} on ${appointment.date} at ${appointment.time} was approved.`
        : `Your ${appointment.service} request on ${appointment.date} was declined.`,
    appointmentId: appointment.id,
    status,
  });

  const results = await Promise.allSettled(
    userSubscriptions.map(async ([endpoint, entry]) => {
      try {
        await webPush.sendNotification(entry.subscription, payload);
        return 'sent';
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          subscriptions.delete(endpoint);
        }
        throw error;
      }
    }),
  );

  const failed = results.filter(
    (result) => result.status === 'rejected',
  ).length;
  if (failed > 0) {
    console.warn(
      `Push delivery failed for ${failed} subscription(s) on ${appointment.id}.`,
    );
  }

  return {
    attempted: userSubscriptions.length,
    sent: results.filter((result) => result.status === 'fulfilled').length,
    failed,
  };
}

function findPendingAppointment(id, response) {
  const appointment = appointments.find((item) => item.id === id);
  if (!appointment) {
    response.status(404).json({ error: 'Appointment not found.' });
    return null;
  }

  if (appointment.status !== 'pending') {
    response
      .status(409)
      .json({ error: `Appointment is already ${appointment.status}.` });
    return null;
  }

  return appointment;
}

app.post('/api/appointments/:id/approve', async (request, response) => {
  try {
    const appointment = findPendingAppointment(request.params.id, response);
    if (!appointment) return;

    appointment.status = 'approved';
    appointment.decidedAt = new Date().toISOString();
    appointment.calendarSyncStatus = 'pending';

    const outboxTask = {
      id: crypto.randomUUID(),
      type: 'calendar.sync',
      appointmentId: appointment.id,
      status: 'pending',
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    calendarSyncOutbox.push(outboxTask);

    const push = await notifyAppointmentUser(appointment, 'approved');
    return response
      .status(200)
      .json({ appointment, calendarSync: 'queued', push });
  } catch (error) {
    console.error('Could not approve appointment:', error);
    return response.status(500).json({ error: 'Appointment approval failed.' });
  }
});

app.post('/api/appointments/:id/reject', async (request, response) => {
  try {
    const appointment = findPendingAppointment(request.params.id, response);
    if (!appointment) return;

    appointment.status = 'rejected';
    appointment.decidedAt = new Date().toISOString();
    const reason = request.body?.reason;
    if (typeof reason === 'string' && reason.trim())
      appointment.rejectionReason = reason.trim();

    const push = await notifyAppointmentUser(appointment, 'rejected');
    return response.status(200).json({ appointment, push });
  } catch (error) {
    console.error('Could not reject appointment:', error);
    return response
      .status(500)
      .json({ error: 'Appointment rejection failed.' });
  }
});

app.use((error, _request, response, next) => {
  if (response.headersSent) return next(error);
  const status =
    error.status || (error.type === 'entity.parse.failed' ? 400 : 500);
  return response.status(status).json({
    error:
      status === 400 ? 'Invalid JSON request body.' : 'Internal server error.',
  });
});

function startServer(port = PORT) {
  const httpServer = app.listen(port, () => {
    console.log(`Appointment API listening on http://localhost:${port}`);
    calendarWorker.start();
  });
  httpServer.on('close', calendarWorker.stop);
  return httpServer;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  appointments,
  availability,
  subscriptions,
  calendarSyncOutbox,
  vapidPublicKey,
  startServer,
};
