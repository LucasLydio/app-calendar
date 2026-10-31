'use strict';

const crypto = require('node:crypto');
const express = require('express');
const path = require('node:path');
const webPush = require('web-push');
const { buildIcsCalendar, createCalendarWorker } = require('./calendar_worker');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const DAY_ALIASES = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
};
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SERVICE_NAME_LENGTH = 120;
const MAX_SERVICE_PRICE = 1_000_000;
const MAX_SERVICE_DURATION_MINUTES = 1_440;

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

const services = [];

let availability = {
  timeZone: 'UTC',
  weeklySlots: DAY_NAMES.slice(1).concat(DAY_NAMES[0]).map((day) => ({
    day,
    active: !['Saturday', 'Sunday'].includes(day),
    start: '09:00',
    end: '17:00',
    blackoutSlots: [],
  })),
  disabledDates: [],
  blackoutHours: [],
  dateSpecificExceptions: [],
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
app.use(express.static(__dirname));

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

app.get('/time', (_request, response) => {
  return response.sendFile(path.join(__dirname, 'time.html'));
});

app.get('/services', (_request, response) => {
  return response.sendFile(path.join(__dirname, 'services.html'));
});

function validateServicePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object.' };
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > MAX_SERVICE_NAME_LENGTH) {
    return {
      error: `name is required and must be ${MAX_SERVICE_NAME_LENGTH} characters or fewer.`,
    };
  }
  if (
    typeof body.price !== 'number' ||
    !Number.isFinite(body.price) ||
    body.price < 0 ||
    body.price > MAX_SERVICE_PRICE
  ) {
    return {
      error: `price must be a number between 0 and ${MAX_SERVICE_PRICE}.`,
    };
  }
  const priceCents = Math.round(body.price * 100);
  if (Math.abs(body.price * 100 - priceCents) > Number.EPSILON * 100) {
    return { error: 'price may contain at most two decimal places.' };
  }
  if (
    typeof body.durationMinutes !== 'number' ||
    !Number.isInteger(body.durationMinutes) ||
    body.durationMinutes < 1 ||
    body.durationMinutes > MAX_SERVICE_DURATION_MINUTES
  ) {
    return {
      error: `durationMinutes must be an integer between 1 and ${MAX_SERVICE_DURATION_MINUTES}.`,
    };
  }

  return {
    values: {
      name,
      price: Number((priceCents / 100).toFixed(2)),
      priceCents,
      durationMinutes: body.durationMinutes,
    },
  };
}

function serviceIdFromRequest(request) {
  const id = typeof request.query.id === 'string' ? request.query.id.trim() : '';
  return UUID_PATTERN.test(id) ? id : null;
}

app.get('/api/services', (_request, response) => {
  const results = [...services].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return response.status(200).json({ services: results });
});

app.post('/api/services', (request, response) => {
  const validation = validateServicePayload(request.body);
  if (validation.error) {
    return response.status(400).json({
      error: 'Bad Request',
      message: validation.error,
    });
  }

  const service = {
    id: crypto.randomUUID(),
    ...validation.values,
    createdAt: new Date().toISOString(),
  };
  services.push(service);
  return response.status(201).json({ service });
});

app.put('/api/services', (request, response) => {
  const id = serviceIdFromRequest(request);
  if (!id) {
    return response.status(400).json({
      error: 'Bad Request',
      message: 'A valid service id query parameter is required.',
    });
  }

  const validation = validateServicePayload(request.body);
  if (validation.error) {
    return response.status(400).json({
      error: 'Bad Request',
      message: validation.error,
    });
  }

  const service = services.find((item) => item.id === id);
  if (!service) {
    return response
      .status(404)
      .json({ error: 'Not Found', message: 'Service not found.' });
  }
  Object.assign(service, validation.values);
  return response.status(200).json({ service });
});

app.delete('/api/services', (request, response) => {
  const id = serviceIdFromRequest(request);
  if (!id) {
    return response.status(400).json({
      error: 'Bad Request',
      message: 'A valid service id query parameter is required.',
    });
  }

  const index = services.findIndex((item) => item.id === id);
  if (index === -1) {
    return response
      .status(404)
      .json({ error: 'Not Found', message: 'Service not found.' });
  }
  const [deletedService] = services.splice(index, 1);
  return response.status(200).json({ deleted: true, id: deletedService.id });
});

app.get('/api/appointments', (request, response) => {
  if (typeof request.query.ids === 'string') {
    const ids = [...new Set(
      request.query.ids
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )];
    if (
      ids.length === 0 ||
      ids.length > 50 ||
      ids.some((id) => !/^[A-Za-z0-9_-]{1,120}$/.test(id))
    ) {
      return response
        .status(400)
        .json({ error: 'ids must contain 1 to 50 valid appointment IDs.' });
    }
    return response.status(200).json({
      appointments: appointments
        .filter((appointment) => ids.includes(appointment.id))
        .map((appointment) => ({
          id: appointment.id,
          serviceName: appointment.serviceName || appointment.service,
          date: appointment.date,
          time: appointment.time,
          status: appointment.status,
          ...(appointment.rejectionReason && {
            message: appointment.rejectionReason,
          }),
        })),
    });
  }
  const requestedDate = request.query.date;
  const slotView =
    request.query.view === 'slots' ||
    (requestedDate && request.query.status === undefined);
  if (slotView) {
    if (
      typeof requestedDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ) {
      return response
        .status(400)
        .json({ error: 'A valid date (YYYY-MM-DD) is required.' });
    }
    const bookedAppointments = appointments
      .filter(
        (appointment) =>
          appointment.date === requestedDate &&
          ['pending', 'approved'].includes(appointment.status),
      );
    const bookedIntervals = bookedAppointments.map((appointment) => ({
      time: appointment.time,
      durationMinutes: Number.isInteger(appointment.serviceDuration)
        ? appointment.serviceDuration
        : Number(process.env.CALENDAR_APPOINTMENT_DURATION_MINUTES) || 60,
    }));
    const bookedSlots = bookedIntervals.map((interval) => interval.time);
    return response.status(200).json({ bookedSlots, bookedIntervals });
  }

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
  const { name, email, serviceId, date, time } = request.body || {};
  const requestedUserId = request.body?.userId;
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim() : '';
  const selectedService = services.find((service) => service.id === serviceId);
  const durationMinutes = selectedService?.durationMinutes;
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
    typeof serviceId !== 'string' ||
    !UUID_PATTERN.test(serviceId) ||
    !selectedService ||
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !isValidDate ||
    typeof time !== 'string' ||
    !TIME_PATTERN.test(time)
  ) {
    return response.status(400).json({
      error:
        'name, valid email, serviceId, date (YYYY-MM-DD), and time (HH:mm) are required.',
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

  const day = DAY_NAMES[
    new Date(`${date}T00:00:00.000Z`).getUTCDay()
  ];
  const requestedStart = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const requestedEnd = requestedStart + durationMinutes;
  const blockedByDateException = availability.dateSpecificExceptions.some(
    (exception) => {
      if (exception.date !== date) return false;
      const exceptionStart =
        Number(exception.start.slice(0, 2)) * 60 +
        Number(exception.start.slice(3));
      const exceptionEnd =
        Number(exception.end.slice(0, 2)) * 60 + Number(exception.end.slice(3));
      return requestedStart < exceptionEnd && exceptionStart < requestedEnd;
    },
  );
  const isAvailable =
    !blockedByDateException &&
    availability.weeklySlots.some((slot) => {
      if ((DAY_ALIASES[slot.day] || slot.day) !== day || slot.active === false)
        return false;
      const slotStart =
        Number(slot.start.slice(0, 2)) * 60 + Number(slot.start.slice(3));
      const slotEnd =
        Number(slot.end.slice(0, 2)) * 60 + Number(slot.end.slice(3));
      const blackoutSlots = Array.isArray(slot.blackoutSlots)
        ? slot.blackoutSlots
        : Array.isArray(slot.blackout)
          ? slot.blackout
          : [];
      const overlapsBlackout = blackoutSlots.some((period) => {
        const [start, end] = period.split('-');
        const blackoutStart =
          Number(start.slice(0, 2)) * 60 + Number(start.slice(3));
        const blackoutEnd =
          Number(end.slice(0, 2)) * 60 + Number(end.slice(3));
        return requestedStart < blackoutEnd && blackoutStart < requestedEnd;
      });
      return (
        requestedStart >= slotStart &&
        requestedEnd <= slotEnd &&
        (requestedStart - slotStart) % 30 === 0 &&
        !overlapsBlackout
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
    const existingDuration = Number.isInteger(appointment.serviceDuration)
      ? appointment.serviceDuration
      : Number(process.env.CALENDAR_APPOINTMENT_DURATION_MINUTES) || 60;
    return (
      requestedStart < existingStart + existingDuration &&
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
    serviceId: selectedService.id,
    service: selectedService.name,
    serviceName: selectedService.name,
    servicePrice: selectedService.priceCents,
    serviceDuration: selectedService.durationMinutes,
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
      appointment.serviceDuration ||
      Number(process.env.CALENDAR_APPOINTMENT_DURATION_MINUTES) ||
      60,
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
  const dateSpecificExceptions = request.body?.dateSpecificExceptions ?? [];

  if (
    typeof timeZone !== 'string' ||
    !timeZone.trim() ||
    !Array.isArray(weeklySlots) ||
    !Array.isArray(dateSpecificExceptions)
  ) {
    return response
      .status(400)
      .json({ error: 'timeZone and weeklySlots are required.' });
  }

  const slotsAreValid = weeklySlots.every(
    (slot) =>
      slot &&
      (DAY_NAMES.includes(slot.day) || DAY_ALIASES[slot.day]) &&
      (slot.active === undefined || typeof slot.active === 'boolean') &&
      TIME_PATTERN.test(slot.start) &&
      TIME_PATTERN.test(slot.end) &&
      slot.start < slot.end &&
      (slot.blackoutSlots === undefined ||
        (Array.isArray(slot.blackoutSlots) &&
          slot.blackoutSlots.every((period) => {
            if (typeof period !== 'string') return false;
            const [start, end] = period.split('-');
            return (
              TIME_PATTERN.test(start) &&
              TIME_PATTERN.test(end) &&
              start < end &&
              start >= slot.start &&
              end <= slot.end
            );
          }))),
  );
  const exceptionsAreValid = dateSpecificExceptions.every(
    (exception) =>
      exception &&
      typeof exception.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(exception.date) &&
      TIME_PATTERN.test(exception.start) &&
      TIME_PATTERN.test(exception.end) &&
      exception.start < exception.end,
  );

  if (!slotsAreValid || !exceptionsAreValid) {
    return response.status(400).json({
      error:
        'Each slot needs a valid weekday and start/end times, with end after start.',
    });
  }

  availability = {
    timeZone: timeZone.trim(),
    weeklySlots: weeklySlots.map(
      ({ day, active, start, end, blackoutSlots, blackout }) => ({
        day: DAY_ALIASES[day] || day,
        active: active !== false,
        start,
        end,
        blackoutSlots: Array.isArray(blackoutSlots)
          ? blackoutSlots
          : Array.isArray(blackout)
            ? blackout
            : [],
      }),
    ),
    disabledDates: [],
    blackoutHours: [],
    dateSpecificExceptions: dateSpecificExceptions
      .map(({ date, start, end }) => ({ date, start, end }))
      .sort((a, b) =>
        `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`),
      ),
  };

  return response.status(200).json({ availability });
});

app.get('/api/push/vapid-public-key', (_request, response) => {
  return response.status(200).json({ publicKey: vapidPublicKey });
});

app.get('/api/push', (_request, response) => {
  return response.status(200).json({ publicKey: vapidPublicKey });
});

app.post('/api/push', (request, response) => {
  const { userId, appointmentId, subscription } = request.body || {};
  const appointment = appointments.find((item) => item.id === appointmentId);
  if (typeof userId !== 'string' || !userId.trim()) {
    return response.status(400).json({ error: 'userId is required.' });
  }
  if (typeof appointmentId !== 'string' || !appointmentId.trim()) {
    return response.status(400).json({ error: 'appointmentId is required.' });
  }
  if (!appointment) {
    return response.status(404).json({ error: 'Appointment not found.' });
  }
  if (appointment.userId !== userId.trim()) {
    return response.status(403).json({
      error: 'The appointment does not belong to this browser.',
    });
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
  const existing = subscriptions.get(subscription.endpoint);
  const appointmentIds = new Set(existing?.appointmentIds || []);
  appointmentIds.add(appointmentId);
  subscriptions.set(subscription.endpoint, {
    id: subscriptionId,
    userId: userId.trim(),
    subscription,
    appointmentIds: [...appointmentIds],
  });
  return response.status(201).json({
    userId: userId.trim(),
    appointmentId,
    registered: true,
  });
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
    title: 'Appointment Status Updated',
    body: `Your ${appointment.service} appointment on ${appointment.date} at ${appointment.time} is now ${status === 'approved' ? 'Confirmed' : 'Cancelled'}.${appointment.rejectionReason ? ` Message: ${appointment.rejectionReason}` : ''}`,
    url: '/book.html',
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
  services,
  availability,
  subscriptions,
  calendarSyncOutbox,
  vapidPublicKey,
  startServer,
};
