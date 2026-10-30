import { asc, eq } from 'drizzle-orm';
import {
  availability as availabilityTable,
  dateSpecificExceptions as dateSpecificExceptionsTable,
} from '../../db/schema.ts';
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
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_USER_ID = 'default';
const DEFAULT_AVAILABILITY = {
  timeZone: 'UTC',
  weeklySlots: DAYS.map((day) => ({
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

function canonicalDay(day) {
  return DAY_ALIASES[day] || (DAYS.includes(day) ? day : null);
}

function validBlackout(period, start, end) {
  if (typeof period !== 'string' || !BLACKOUT_PATTERN.test(period))
    return false;
  const [blackoutStart, blackoutEnd] = period.split('-');
  return (
    blackoutStart < blackoutEnd &&
    blackoutStart >= start &&
    blackoutEnd <= end
  );
}

function validBlackoutSlots(periods, start, end) {
  if (!Array.isArray(periods)) return false;
  const sorted = [...periods].sort();
  return (
    sorted.every((period) => validBlackout(period, start, end)) &&
    sorted.every((period, index) => {
      if (index === 0) return true;
      const previousEnd = sorted[index - 1].split('-')[1];
      const currentStart = period.split('-')[0];
      return previousEnd <= currentStart;
    })
  );
}

function slotBlackoutsAreValid(slot) {
  if (
    slot.blackoutSlots !== undefined &&
    !Array.isArray(slot.blackoutSlots)
  ) {
    return false;
  }
  if (
    slot.blackoutSlots === undefined &&
    slot.blackout !== undefined &&
    !Array.isArray(slot.blackout)
  ) {
    return false;
  }
  return validBlackoutSlots(
    slot.blackoutSlots ?? slot.blackout ?? [],
    slot.start,
    slot.end,
  );
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
      blackoutSlots: (Array.isArray(slot?.blackoutSlots)
        ? slot.blackoutSlots
        : Array.isArray(slot?.blackout)
          ? slot.blackout
          : []
      ).filter((period) => validBlackout(period, start, end)),
    };
  });
}

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function normalizeDateExceptions(exceptions) {
  return (Array.isArray(exceptions) ? exceptions : [])
    .map((exception) => ({
      date: String(exception?.date || exception?.exceptionDate || '').slice(
        0,
        10,
      ),
      start: String(exception?.start || exception?.startTime || '').slice(0, 5),
      end: String(exception?.end || exception?.endTime || '').slice(0, 5),
    }))
    .sort((a, b) =>
      `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`),
    );
}

function dateExceptionsAreValid(exceptions) {
  if (!Array.isArray(exceptions)) return false;
  const normalized = normalizeDateExceptions(exceptions);
  if (
    !normalized.every(
      (exception) =>
        isValidDate(exception.date) &&
        TIME_PATTERN.test(exception.start) &&
        TIME_PATTERN.test(exception.end) &&
        exception.start < exception.end,
    )
  ) {
    return false;
  }
  return normalized.every((exception, index) => {
    if (index === 0) return true;
    const previous = normalized[index - 1];
    return (
      previous.date !== exception.date || previous.end <= exception.start
    );
  });
}

function availabilityPayload(timeZone, slots, dateExceptions = []) {
  return {
    timeZone: typeof timeZone === 'string' && timeZone ? timeZone : 'UTC',
    weeklySlots: normalizeSlots(slots),
    disabledDates: [],
    blackoutHours: [],
    dateSpecificExceptions: normalizeDateExceptions(dateExceptions),
  };
}

export default async function handler(request) {
  try {
    if (request.method === 'GET') {
      const [[row], dateExceptions] = await Promise.all([
        db.select().from(availabilityTable).limit(1),
        db
          .select()
          .from(dateSpecificExceptionsTable)
          .where(eq(dateSpecificExceptionsTable.userId, DEFAULT_USER_ID))
          .orderBy(
            asc(dateSpecificExceptionsTable.exceptionDate),
            asc(dateSpecificExceptionsTable.startTime),
          ),
      ]);
      return jsonResponse({
        availability: row
          ? availabilityPayload(
              row.timeZone,
              row.weeklySlots,
              dateExceptions,
            )
          : {
              ...DEFAULT_AVAILABILITY,
              dateSpecificExceptions: normalizeDateExceptions(dateExceptions),
            },
      });
    }
    if (!['POST', 'PUT'].includes(request.method)) {
      return jsonResponse({ error: 'Method not allowed.' }, 405, {
        Allow: 'GET, POST, PUT',
      });
    }

    const body = await readJson(request);
    const { timeZone, weeklySlots } = body;
    const dateSpecificExceptions = body.dateSpecificExceptions ?? [];
    if (
      typeof timeZone !== 'string' ||
      !timeZone.trim() ||
      !Array.isArray(weeklySlots) ||
      !dateExceptionsAreValid(dateSpecificExceptions)
    ) {
      return jsonResponse(
        {
          error:
            'timeZone, weeklySlots, and valid non-overlapping dateSpecificExceptions are required.',
        },
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
          slotBlackoutsAreValid(slot),
      );
    if (!validSlots) {
      return jsonResponse(
        {
          error:
            'Each unique day needs active, valid start/end times, and blackoutSlots within its operating hours.',
        },
        400,
      );
    }

    const normalizedSlots = normalizeSlots(weeklySlots);
    const normalizedExceptions = normalizeDateExceptions(
      dateSpecificExceptions,
    );
    const row = await db.transaction(async (transaction) => {
      const [savedAvailability] = await transaction
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
      await transaction
        .delete(dateSpecificExceptionsTable)
        .where(eq(dateSpecificExceptionsTable.userId, DEFAULT_USER_ID));
      if (normalizedExceptions.length > 0) {
        await transaction.insert(dateSpecificExceptionsTable).values(
          normalizedExceptions.map((exception) => ({
            userId: DEFAULT_USER_ID,
            exceptionDate: exception.date,
            startTime: exception.start,
            endTime: exception.end,
          })),
        );
      }
      return savedAvailability;
    });
    return jsonResponse({
      availability: {
        ...availabilityPayload(
          row?.timeZone,
          row?.weeklySlots,
          normalizedExceptions,
        ),
      },
    });
  } catch (error) {
    console.error('Availability API Error:', error);
    return errorResponse(error);
  }
}
