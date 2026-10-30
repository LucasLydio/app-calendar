import { eq } from 'drizzle-orm';
import { db } from '../../../db/index.ts';
import {
  availability,
  dateSpecificExceptions,
  pushSubscriptions,
} from '../../../db/schema.ts';

export { db };

export function appointmentFromRow(row) {
  return {
    id: row.id,
    userId: row.userId,
    name: row.customerName,
    email: row.customerEmail,
    service: row.service,
    date: String(row.requestedDate).slice(0, 10),
    time: String(row.requestedTime).slice(0, 5),
    status: row.status,
    calendarSyncStatus: row.calendarSyncStatus,
    ...(row.calendarSyncError && {
      calendarSyncError: row.calendarSyncError,
    }),
    ...(row.calendarSyncedAt && {
      calendarSyncedAt: new Date(row.calendarSyncedAt).toISOString(),
    }),
    ...(row.googleEventId && { googleEventId: row.googleEventId }),
    ...(row.rejectionReason && { rejectionReason: row.rejectionReason }),
    createdAt: new Date(row.createdAt).toISOString(),
    ...(row.decidedAt && {
      decidedAt: new Date(row.decidedAt).toISOString(),
    }),
  };
}

export async function getAvailability(database = db) {
  const availabilityRows = await database.select().from(availability).limit(1);
  const row = Array.isArray(availabilityRows)
    ? availabilityRows[0]
    : undefined;
  let exceptionRows = [];
  try {
    const rows = await database
      .select()
      .from(dateSpecificExceptions)
      .where(eq(dateSpecificExceptions.userId, 'default'));
    exceptionRows = Array.isArray(rows) ? rows : [];
  } catch (error) {
    const missingTable =
      error?.code === '42P01' || error?.cause?.code === '42P01';
    if (!missingTable) throw error;
    console.warn(
      'date_specific_exceptions is not migrated yet; booking checks will use recurring availability only.',
    );
  }
  if (!row)
    throw new Error('Availability is missing from the database schema.');
  return {
    timeZone: row.timeZone,
    weeklySlots: row.weeklySlots,
    dateSpecificExceptions: exceptionRows.map((exception) => ({
      date: String(exception.exceptionDate).slice(0, 10),
      start: String(exception.startTime).slice(0, 5),
      end: String(exception.endTime).slice(0, 5),
    })),
  };
}

export async function getSubscriptionsForUser(userId, database = db) {
  const rows = await database
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  return rows.map((row) => ({
    endpoint: row.endpoint,
    subscription: { endpoint: row.endpoint, keys: row.keys },
  }));
}
