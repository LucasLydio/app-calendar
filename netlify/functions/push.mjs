import { getSql } from './lib/db.mjs';
import { errorResponse, jsonResponse, readJson } from './lib/http.mjs';
import { getVapidPublicKey, savePushSubscription } from './lib/push.mjs';

export default async function handler(request) {
  try {
    if (request.method === 'GET') {
      return jsonResponse({ publicKey: getVapidPublicKey() });
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });
    }
    const body = await readJson(request);
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const subscription = body.subscription;
    if (!userId) return jsonResponse({ error: 'userId is required.' }, 400);
    if (
      !subscription ||
      typeof subscription.endpoint !== 'string' ||
      !subscription.endpoint.startsWith('https://') ||
      typeof subscription.keys?.p256dh !== 'string' ||
      typeof subscription.keys?.auth !== 'string'
    ) {
      return jsonResponse({ error: 'A valid Web Push subscription is required.' }, 400);
    }
    await savePushSubscription({ userId, subscription }, getSql());
    return jsonResponse({ userId }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
