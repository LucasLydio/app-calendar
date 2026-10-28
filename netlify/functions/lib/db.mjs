import { eq } from 'drizzle-orm';
import { db } from '../../../db/index.ts';
import { availability, pushSubscriptions } from '../../../db/schema.ts';

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
  const [row] = await database.select().from(availability).limit(1);
  if (!row)
    throw new Error(
      'Availability is missing from the Netlify Database schema.',
    );
  return { timeZone: row.timeZone, weeklySlots: row.weeklySlots };
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
