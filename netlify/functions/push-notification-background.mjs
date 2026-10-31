import { errorResponse } from './lib/http.mjs';
import { sendAppointmentPush } from './lib/push.mjs';

export default async function handler(request) {
  try {
    const expectedToken = process.env.INTERNAL_FUNCTION_TOKEN;
    if (
      !expectedToken ||
      request.headers.get('x-internal-function-token') !== expectedToken
    ) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { appointment, status, message } = await request.json();
    if (!appointment?.userId || !['approved', 'rejected'].includes(status)) {
      return new Response('Invalid notification payload', { status: 400 });
    }
    const result = await sendAppointmentPush(
      appointment,
      status,
      message,
    );
    if (result.failed) {
      console.error(
        `Push delivery failed for ${result.failed} subscription(s) on ${appointment.id}.`,
      );
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Background push delivery failed:', error);
    return errorResponse(error);
  }
}

export const config = { background: true };
