import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import webPush from 'web-push';
import { pushSubscriptions } from '../../../db/schema.ts';
import { db, getSubscriptionsForUser } from './db.mjs';

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
  { userId, subscription },
  database = db,
) {
  const browserId = crypto
    .createHash('sha256')
    .update(subscription.endpoint)
    .digest('hex');
  await database
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
}

export async function sendAppointmentPush(appointment, status, database = db) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('Push delivery skipped: VAPID keys are not configured.');
    return { attempted: 0, sent: 0, failed: 0 };
  }
  getVapidPublicKey();
  const subscriptions = await getSubscriptionsForUser(
    appointment.userId,
    database,
  );
  const payload = JSON.stringify({
    title:
      status === 'approved' ? 'Appointment approved' : 'Appointment update',
    body:
      status === 'approved'
        ? `Your ${appointment.service} on ${appointment.date} at ${appointment.time} was approved.`
        : `Your ${appointment.service} request on ${appointment.date} was declined.`,
    appointmentId: appointment.id,
    status,
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
