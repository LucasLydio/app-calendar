import { getAvailability, getSql } from './lib/db.mjs';
import { errorResponse, jsonResponse, readJson } from './lib/http.mjs';

const DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export default async function handler(request) {
  try {
    const sql = getSql();
    if (request.method === 'GET') {
      return jsonResponse({ availability: await getAvailability(sql) });
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
    const rows = await sql`
      UPDATE manager_availability
      SET time_zone = ${timeZone.trim()}, weekly_slots = ${JSON.stringify(normalizedSlots)}::jsonb,
          updated_at = now()
      WHERE singleton_id = 1
      RETURNING time_zone, weekly_slots
    `;
    return jsonResponse({
      availability: {
        timeZone: rows[0].time_zone,
        weeklySlots: rows[0].weekly_slots,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
