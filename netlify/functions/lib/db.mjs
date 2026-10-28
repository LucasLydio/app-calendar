import { neon } from '@neondatabase/serverless';

let sql;

export function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be configured for Netlify Functions.');
  }
  sql ||= neon(process.env.DATABASE_URL);
  return sql;
}

export function appointmentFromRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.customer_name,
    email: row.customer_email,
    service: row.service,
    date: String(row.appointment_date).slice(0, 10),
    time: String(row.appointment_time).slice(0, 5),
    status: row.status,
    calendarSyncStatus: row.calendar_sync_status,
    ...(row.calendar_sync_error && {
      calendarSyncError: row.calendar_sync_error,
    }),
    ...(row.calendar_synced_at && {
      calendarSyncedAt: new Date(row.calendar_synced_at).toISOString(),
    }),
    ...(row.google_event_id && { googleEventId: row.google_event_id }),
    ...(row.rejection_reason && { rejectionReason: row.rejection_reason }),
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.decided_at && {
      decidedAt: new Date(row.decided_at).toISOString(),
    }),
  };
}

export async function getAvailability(sql = getSql()) {
  const rows = await sql`
    SELECT time_zone, weekly_slots
    FROM manager_availability
    WHERE singleton_id = 1
  `;
  if (!rows[0])
    throw new Error(
      'Availability is not initialized. Run the database migration.',
    );
  return { timeZone: rows[0].time_zone, weeklySlots: rows[0].weekly_slots };
}

export async function getSubscriptionsForUser(userId, sql = getSql()) {
  return sql`
    SELECT endpoint, subscription
    FROM push_subscriptions
    WHERE user_id = ${userId}
  `;
}
