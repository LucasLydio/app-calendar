import { eq } from 'drizzle-orm';
import webPush from 'web-push';
import { pushSubscriptions } from '../../db/schema.ts';
import { db, getSubscriptionsForUser } from './lib/db.mjs';
import { errorResponse } from './lib/http.mjs';
import { getVapidPublicKey } from './lib/push.mjs';

export default async function handler(request) {
  try {
    const expectedToken = process.env.INTERNAL_FUNCTION_TOKEN;
    if (
      !expectedToken ||
      request.headers.get('x-internal-function-token') !== expectedToken
    ) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { appointment, status } = await request.json();
    if (!appointment?.userId || !['approved', 'rejected'].includes(status)) {
      return new Response('Invalid notification payload', { status: 400 });
    }
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      console.warn('Push delivery skipped: VAPID keys are not configured.');
      return new Response('Push is not configured', { status: 200 });
    }
    getVapidPublicKey();
    const subscriptions = await getSubscriptionsForUser(appointment.userId, db);
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
      subscriptions.map(async ({ endpoint, subscription }) => {
        try {
          await webPush.sendNotification(subscription, payload);
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            await db
              .delete(pushSubscriptions)
              .where(eq(pushSubscriptions.endpoint, endpoint));
          }
          throw error;
        }
      }),
    );
    const failed = results.filter(
      (result) => result.status === 'rejected',
    ).length;
    if (failed) {
      console.error(
        `Push delivery failed for ${failed} subscription(s) on ${appointment.id}.`,
      );
    }
    return new Response('Push notifications processed.', { status: 200 });
  } catch (error) {
    console.error('Background push delivery failed:', error);
    return errorResponse(error);
  }
}

export const config = { background: true };
