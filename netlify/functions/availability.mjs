import { availability as availabilityTable } from '../../db/schema.ts';
import { db } from './lib/db.mjs';
import { errorResponse, jsonResponse, readJson } from './lib/http.mjs';

const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const DAY_ALIASES = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const BLACKOUT_PATTERN = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_AVAILABILITY = {
  timeZone: 'UTC',
  weeklySlots: DAYS.map((day) => ({
    day,
    active: !['Saturday', 'Sunday'].includes(day),
    start: '09:00',
    end: '17:00',
    blackout: [],
  })),
  disabledDates: [],
  blackoutHours: [],
};

function canonicalDay(day) {
  return DAY_ALIASES[day] || (DAYS.includes(day) ? day : null);
}

function validBlackout(period, start, end) {
  if (typeof period !== 'string' || !BLACKOUT_PATTERN.test(period))
    return false;
  const [blackoutStart, blackoutEnd] = period.split('-');
  return blackoutStart < blackoutEnd && blackoutStart >= start && blackoutEnd <= end;
}

function normalizeSlots(slots) {
  const byDay = new Map(
    (Array.isArray(slots) ? slots : [])
      .map((slot) => [canonicalDay(slot?.day), slot])
      .filter(([day]) => day),
  );
  return DAYS.map((day) => {
    const slot = byDay.get(day);
    const start = TIME_PATTERN.test(slot?.start) ? slot.start : '09:00';
    const candidateEnd = TIME_PATTERN.test(slot?.end) ? slot.end : '17:00';
    const end = candidateEnd > start ? candidateEnd : '17:00';
    return {
      day,
      active: slot ? slot.active !== false : false,
      start,
      end,
      blackout: (Array.isArray(slot?.blackout) ? slot.blackout : []).filter(
        (period) => validBlackout(period, start, end),
      ),
    };
  });
}

function availabilityPayload(timeZone, slots) {
  return {
    timeZone: typeof timeZone === 'string' && timeZone ? timeZone : 'UTC',
    weeklySlots: normalizeSlots(slots),
    disabledDates: [],
    blackoutHours: [],
  };
}

export default async function handler(request) {
  try {
    if (request.method === 'GET') {
      const [row] = await db.select().from(availabilityTable).limit(1);
      return jsonResponse({
        availability: row
          ? availabilityPayload(row.timeZone, row.weeklySlots)
          : DEFAULT_AVAILABILITY,
      });
    }
    if (!['POST', 'PUT'].includes(request.method)) {
      return jsonResponse({ error: 'Method not allowed.' }, 405, {
        Allow: 'GET, POST, PUT',
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
    const normalizedDays = weeklySlots.map((slot) => canonicalDay(slot?.day));
    const validSlots =
      weeklySlots.length <= DAYS.length &&
      new Set(normalizedDays).size === normalizedDays.length &&
      weeklySlots.every(
        (slot) =>
          slot &&
          canonicalDay(slot.day) &&
          (slot.active === undefined || typeof slot.active === 'boolean') &&
          typeof slot.start === 'string' &&
          TIME_PATTERN.test(slot.start) &&
          typeof slot.end === 'string' &&
          TIME_PATTERN.test(slot.end) &&
          slot.start < slot.end &&
          (slot.blackout === undefined ||
            (Array.isArray(slot.blackout) &&
              slot.blackout.every((period) =>
                validBlackout(period, slot.start, slot.end),
              ))),
      );
    if (!validSlots) {
      return jsonResponse(
        {
          error:
            'Each unique day needs active, valid start/end times, and blackout periods within its operating hours.',
        },
        400,
      );
    }

    const normalizedSlots = normalizeSlots(weeklySlots);
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
        ...availabilityPayload(row?.timeZone, row?.weeklySlots),
      },
    });
  } catch (error) {
    console.error('Availability API Error:', error);
    return errorResponse(error);
  }
}
