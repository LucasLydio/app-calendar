import { eq } from 'drizzle-orm';
import { appointments } from '../../db/schema.ts';
import { db } from './lib/db.mjs';
import { errorResponse, jsonResponse, readJson } from './lib/http.mjs';
import { getVapidPublicKey, savePushSubscription } from './lib/push.mjs';

export default async function handler(request) {
  try {
    if (request.method === 'GET') {
      return jsonResponse({ publicKey: getVapidPublicKey() });
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed.' }, 405, {
        Allow: 'GET, POST',
      });
    }
    const body = await readJson(request);
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const appointmentId =
      typeof body.appointmentId === 'string' ? body.appointmentId.trim() : '';
    const subscription = body.subscription;
    if (!userId) return jsonResponse({ error: 'userId is required.' }, 400);
    if (!appointmentId) {
      return jsonResponse({ error: 'appointmentId is required.' }, 400);
    }
    if (
      !subscription ||
      typeof subscription.endpoint !== 'string' ||
      !subscription.endpoint.startsWith('https://') ||
      typeof subscription.keys?.p256dh !== 'string' ||
      typeof subscription.keys?.auth !== 'string'
    ) {
      return jsonResponse(
        { error: 'A valid Web Push subscription is required.' },
        400,
      );
    }
    const [appointment] = await db
      .select({ id: appointments.id, userId: appointments.userId })
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1);
    if (!appointment) {
      return jsonResponse({ error: 'Appointment not found.' }, 404);
    }
    if (appointment.userId !== userId) {
      return jsonResponse(
        { error: 'The appointment does not belong to this browser.' },
        403,
      );
    }
    await savePushSubscription(
      { userId, appointmentId, subscription },
      db,
    );
    return jsonResponse({ userId, appointmentId, registered: true }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
