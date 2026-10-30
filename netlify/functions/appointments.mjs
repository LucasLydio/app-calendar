import { and, asc, eq, inArray } from 'drizzle-orm';
import crypto from 'node:crypto';
import { appointments } from '../../db/schema.ts';
import { appointmentFromRow, db, getAvailability } from './lib/db.mjs';
import { errorResponse, jsonResponse, readJson } from './lib/http.mjs';

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const LEGACY_DAYS = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
};
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DURATION_MINUTES =
  Number(process.env.CALENDAR_APPOINTMENT_DURATION_MINUTES) || 60;

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function futureInZone(date, time, timeZone) {
  const current = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  return `${date} ${time}` > current;
}

function slotIsAvailable(weeklySlots, dateSpecificExceptions, date, time) {
  const day = DAYS[new Date(`${date}T00:00:00.000Z`).getUTCDay()];
  const requestedStart = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const requestedEnd = requestedStart + DURATION_MINUTES;
  const overlapsDateException = (Array.isArray(dateSpecificExceptions)
    ? dateSpecificExceptions
    : []
  ).some((exception) => {
    if (exception.date !== date) return false;
    const [startHour, startMinute] = exception.start.split(':').map(Number);
    const [endHour, endMinute] = exception.end.split(':').map(Number);
    const exceptionStart = startHour * 60 + startMinute;
    const exceptionEnd = endHour * 60 + endMinute;
    return requestedStart < exceptionEnd && exceptionStart < requestedEnd;
  });
  if (overlapsDateException) return false;
  return (Array.isArray(weeklySlots) ? weeklySlots : []).some((slot) => {
    const slotDay = LEGACY_DAYS[slot.day] || slot.day;
    if (slotDay !== day || slot.active === false) return false;
    const slotStart =
      Number(slot.start.slice(0, 2)) * 60 + Number(slot.start.slice(3));
    const slotEnd =
      Number(slot.end.slice(0, 2)) * 60 + Number(slot.end.slice(3));
    const blackoutSlots = Array.isArray(slot.blackoutSlots)
      ? slot.blackoutSlots
      : Array.isArray(slot.blackout)
        ? slot.blackout
        : [];
    const overlapsBlackout = blackoutSlots
      .filter((period) =>
        /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(
          period,
        ),
      )
      .some((period) => {
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
      (requestedStart - slotStart) % DURATION_MINUTES === 0 &&
      !overlapsBlackout
    );
  });
}

export default async function handler(request) {
  try {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const requestedDate = url.searchParams.get('date');
      const slotView =
        url.searchParams.get('view') === 'slots' ||
        (requestedDate && !url.searchParams.has('status'));
      if (slotView) {
        const date = requestedDate;
        if (!isValidDate(date)) {
          return jsonResponse(
            { error: 'A valid date (YYYY-MM-DD) is required.' },
            400,
          );
        }
        const bookedRows = await db
          .select({ requestedTime: appointments.requestedTime })
          .from(appointments)
          .where(
            and(
              eq(appointments.requestedDate, date),
              inArray(appointments.status, ['pending', 'approved']),
            ),
          );
        const bookedSlots = (Array.isArray(bookedRows) ? bookedRows : []).map(
          (row) =>
            String(row.requestedTime).slice(0, 5),
        );
        return jsonResponse({
          bookedSlots,
        });
      }
      const status = url.searchParams.get('status') || 'pending';
      if (!['pending', 'approved', 'rejected', 'all'].includes(status)) {
        return jsonResponse(
          { error: 'status must be pending, approved, rejected, or all.' },
          400,
        );
      }
      let query = db
        .select()
        .from(appointments)
        .orderBy(
          asc(appointments.requestedDate),
          asc(appointments.requestedTime),
        );
      if (status !== 'all')
        query = query.where(eq(appointments.status, status));
      const rows = await query;
      return jsonResponse({
        appointments: (Array.isArray(rows) ? rows : []).map(appointmentFromRow),
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed.' }, 405, {
        Allow: 'GET, POST',
      });
    }

    const body = await readJson(request);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const { date, time } = body;
    if (
      !name ||
      name.length > 120 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      !isValidDate(date) ||
      typeof time !== 'string' ||
      !TIME_PATTERN.test(time)
    ) {
      return jsonResponse(
        {
          error:
            'name, valid email, date (YYYY-MM-DD), and time (HH:mm) are required.',
        },
        400,
      );
    }
    if (
      body.userId !== undefined &&
      (typeof body.userId !== 'string' || !body.userId.trim())
    ) {
      return jsonResponse({ error: 'userId must be a non-empty string.' }, 400);
    }

    const currentAvailability = await getAvailability();
    if (
      !slotIsAvailable(
        currentAvailability.weeklySlots,
        currentAvailability.dateSpecificExceptions,
        date,
        time,
      )
    ) {
      return jsonResponse(
        {
          error:
            'That time is outside the configured appointment availability.',
        },
        409,
      );
    }
    if (!futureInZone(date, time, currentAvailability.timeZone)) {
      return jsonResponse(
        { error: 'Appointments must be requested for a future date and time.' },
        409,
      );
    }

    const appointment = {
      id: `apt-${crypto.randomUUID()}`,
      userId: body.userId?.trim() || `user-${crypto.randomUUID()}`,
      name,
      email,
      service: 'Consultation',
      date,
      time,
    };
    const [row] = await db
      .insert(appointments)
      .values({
        id: appointment.id,
        userId: appointment.userId,
        customerName: appointment.name,
        customerEmail: appointment.email,
        service: appointment.service,
        requestedDate: appointment.date,
        requestedTime: appointment.time,
      })
      .returning();
    return jsonResponse(
      { appointment: appointmentFromRow(row), userId: appointment.userId },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
