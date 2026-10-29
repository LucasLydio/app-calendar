import { availability as availabilityTable } from '../../db/schema.ts';
import { db } from './lib/db.mjs';
import { errorResponse, jsonResponse, readJson } from './lib/http.mjs';

const DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_AVAILABILITY = {
  timeZone: 'UTC',
  weeklySlots: [
    { day: 'mon', start: '09:00', end: '17:00' },
    { day: 'tue', start: '09:00', end: '17:00' },
    { day: 'wed', start: '09:00', end: '17:00' },
    { day: 'thu', start: '09:00', end: '17:00' },
    { day: 'fri', start: '09:00', end: '17:00' },
  ],
};

export default async function handler(request) {
  try {
    if (request.method === 'GET') {
      const [row] = await db.select().from(availabilityTable).limit(1);
      return jsonResponse({
        availability: row
          ? { timeZone: row.timeZone, weeklySlots: row.weeklySlots }
          : DEFAULT_AVAILABILITY,
      });
    }
    if (request.method !== 'PUT') {
      return jsonResponse({ error: 'Method not allowed.' }, 405, {
        Allow: 'GET, PUT',
      });
    }

    const body = await readJson(request);
    const { timeZone, weeklySlots } = body;
    if (
      typeof timeZone !== 'string' ||
      !timeZone.trim() ||
      !Array.isArray(weeklySlots)
    ) {
      return jsonResponse(
        { error: 'timeZone and weeklySlots are required.' },
        400,
      );
    }
    try {
      new Intl.DateTimeFormat('en', { timeZone: timeZone.trim() });
    } catch {
      return jsonResponse(
        { error: 'timeZone must be a valid IANA time zone.' },
        400,
      );
    }
    const validSlots = weeklySlots.every(
      (slot) =>
        slot &&
        DAYS.has(slot.day) &&
        typeof slot.start === 'string' &&
        TIME_PATTERN.test(slot.start) &&
        typeof slot.end === 'string' &&
        TIME_PATTERN.test(slot.end) &&
        slot.start < slot.end,
    );
    if (!validSlots) {
      return jsonResponse(
        {
          error:
            'Each slot needs a valid weekday and start/end times, with end after start.',
        },
        400,
      );
    }

    const normalizedSlots = weeklySlots.map(({ day, start, end }) => ({
      day,
      start,
      end,
    }));
    const [row] = await db
      .insert(availabilityTable)
      .values({ timeZone: timeZone.trim(), weeklySlots: normalizedSlots })
      .onConflictDoUpdate({
        target: availabilityTable.singletonId,
        set: {
          timeZone: timeZone.trim(),
          weeklySlots: normalizedSlots,
          updatedAt: new Date(),
        },
      })
      .returning();
    return jsonResponse({
      availability: {
        timeZone: row.timeZone,
        weeklySlots: row.weeklySlots,
      },
    });
  } catch (error) {
    console.error('Availability API Error:', error);
    return errorResponse(error);
  }
}
