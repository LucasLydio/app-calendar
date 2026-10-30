import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  date,
  time,
  integer,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export type WeeklySlot = {
  day:
    | 'Monday'
    | 'Tuesday'
    | 'Wednesday'
    | 'Thursday'
    | 'Friday'
    | 'Saturday'
    | 'Sunday';
  active: boolean;
  start: string;
  end: string;
  blackoutSlots: string[];
};

export const availability = pgTable(
  'availability',
  {
    singletonId: integer('singleton_id').primaryKey().default(1),
    timeZone: text('time_zone').notNull(),
    weeklySlots: jsonb('weekly_slots').$type<WeeklySlot[]>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [check('availability_singleton_check', sql`${table.singletonId} = 1`)],
);

export const dateSpecificExceptions = pgTable(
  'date_specific_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().default('default'),
    exceptionDate: date('exception_date').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'date_specific_exceptions_time_check',
      sql`${table.startTime} < ${table.endTime}`,
    ),
    uniqueIndex('date_specific_exceptions_unique_idx').on(
      table.userId,
      table.exceptionDate,
      table.startTime,
      table.endTime,
    ),
    index('date_specific_exceptions_user_date_idx').on(
      table.userId,
      table.exceptionDate,
    ),
  ],
);

export const appointments = pgTable(
  'appointments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    customerName: text('customer_name').notNull(),
    customerEmail: text('customer_email').notNull(),
    service: text('service').notNull(),
    requestedDate: date('appointment_date').notNull(),
    requestedTime: time('appointment_time').notNull(),
    status: text('status')
      .$type<'pending' | 'approved' | 'rejected'>()
      .notNull()
      .default('pending'),
    calendarSyncStatus: text('calendar_sync_status')
      .$type<'not_queued' | 'pending' | 'synced' | 'failed'>()
      .notNull()
      .default('not_queued'),
    calendarSyncError: text('calendar_sync_error'),
    calendarSyncedAt: timestamp('calendar_synced_at', { withTimezone: true }),
    googleEventId: text('google_event_id'),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'appointments_status_check',
      sql`${table.status} IN ('pending', 'approved', 'rejected')`,
    ),
    check(
      'appointments_calendar_sync_status_check',
      sql`${table.calendarSyncStatus} IN ('not_queued', 'pending', 'synced', 'failed')`,
    ),
    index('appointments_status_date_idx').on(
      table.status,
      table.requestedDate,
      table.requestedTime,
    ),
    uniqueIndex('appointments_active_slot_unique_idx')
      .on(table.requestedDate, table.requestedTime)
      .where(sql`${table.status} IN ('pending', 'approved')`),
  ],
);

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    browserId: text('browser_id').primaryKey(),
    endpoint: text('endpoint').notNull().unique(),
    keys: jsonb('keys').$type<{ p256dh: string; auth: string }>().notNull(),
    userId: text('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('push_subscriptions_user_id_idx').on(table.userId)],
);

export const calendarOutbox = pgTable(
  'calendar_outbox',
  {
    id: uuid('id').primaryKey(),
    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointments.id),
    action: text('action').notNull().default('create'),
    status: text('status')
      .$type<'pending' | 'processing' | 'synced' | 'failed'>()
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastError: text('last_error'),
    googleEventId: text('google_event_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'calendar_outbox_status_check',
      sql`${table.status} IN ('pending', 'processing', 'synced', 'failed')`,
    ),
    index('calendar_outbox_due_idx').on(
      table.status,
      table.nextAttemptAt,
      table.createdAt,
    ),
    uniqueIndex('calendar_outbox_active_appointment_idx')
      .on(table.appointmentId)
      .where(sql`${table.status} IN ('pending', 'processing')`),
  ],
);
