import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import webPush from 'web-push';
import {
  appointmentPushSubscriptions,
  pushSubscriptions,
} from '../../../db/schema.ts';
import {
  db,
  getSubscriptionsForAppointment,
  getSubscriptionsForUser,
} from './db.mjs';

let vapidConfigured = false;

export function getVapidPublicKey() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error(
      'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured.',
    );
  }
  if (!vapidConfigured) {
    webPush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
      publicKey,
      privateKey,
    );
    vapidConfigured = true;
  }
  return publicKey;
}

export async function savePushSubscription(
  { userId, appointmentId, subscription },
  database = db,
) {
  const browserId = crypto
    .createHash('sha256')
    .update(subscription.endpoint)
    .digest('hex');
  await database.transaction(async (transaction) => {
    await transaction
      .insert(pushSubscriptions)
      .values({
        browserId,
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        userId,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          keys: subscription.keys,
          userId,
          updatedAt: new Date(),
        },
      });
    await transaction
      .insert(appointmentPushSubscriptions)
      .values({ appointmentId, browserId })
      .onConflictDoNothing();
  });
}

function statusLabel(status) {
  return status === 'approved'
    ? 'Confirmed'
    : status === 'rejected'
      ? 'Cancelled'
      : 'Pending';
}

function displayDate(date) {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat('en-US', {
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'UTC',
      }).format(parsed);
}

export async function sendAppointmentPush(
  appointment,
  status,
  message,
  database = db,
) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('Push delivery skipped: VAPID keys are not configured.');
    return { attempted: 0, sent: 0, failed: 0 };
  }
  getVapidPublicKey();
  let subscriptions = [];
  try {
    subscriptions = await getSubscriptionsForAppointment(
      appointment.id,
      database,
    );
  } catch (error) {
    const missingAssociationTable =
      error?.code === '42P01' || error?.cause?.code === '42P01';
    if (!missingAssociationTable) throw error;
    console.warn(
      'appointment_push_subscriptions is not migrated yet; falling back to user subscriptions.',
    );
  }
  if (subscriptions.length === 0) {
    subscriptions = await getSubscriptionsForUser(
      appointment.userId,
      database,
    );
  }
  subscriptions = [...new Map(
    subscriptions.map((entry) => [entry.endpoint, entry]),
  ).values()];
  const label = statusLabel(status);
  const adminMessage = typeof message === 'string' ? message.trim() : '';
  const payload = JSON.stringify({
    title: 'Appointment Status Updated',
    body: `Your ${appointment.service} appointment on ${displayDate(appointment.date)} at ${appointment.time} is now ${label}.${adminMessage ? ` Message: ${adminMessage}` : ''}`,
    url: '/book.html',
    appointmentId: appointment.id,
    status,
    statusLabel: label,
    message: adminMessage || undefined,
  });

  const results = await Promise.allSettled(
    subscriptions.map(async (entry) => {
      try {
        await webPush.sendNotification(entry.subscription, payload);
        return true;
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await database
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.endpoint, entry.endpoint));
        }
        throw error;
      }
    }),
  );
  return {
    attempted: subscriptions.length,
    sent: results.filter((result) => result.status === 'fulfilled').length,
    failed: results.filter((result) => result.status === 'rejected').length,
  };
}
