import crypto from 'node:crypto';
import { appointmentFromRow, getSql } from './lib/db.mjs';
import { errorResponse, jsonResponse, readJson } from './lib/http.mjs';

export default async function handler(request) {
  try {
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed.' }, 405, {
        Allow: 'POST',
      });
    }
    const url = new URL(request.url);
    const appointmentId = url.searchParams.get('id');
    const action = url.searchParams.get('action');
    if (!appointmentId || !['approve', 'reject'].includes(action)) {
      return jsonResponse(
        { error: 'Appointment ID and approve/reject action are required.' },
        400,
      );
    }

    const body = await readJson(request);
    if (
      action === 'reject' &&
      body.reason !== undefined &&
      typeof body.reason !== 'string'
    ) {
      return jsonResponse({ error: 'reason must be a string.' }, 400);
    }
    const sql = getSql();
    const decision = action === 'approve' ? 'approved' : 'rejected';
    const rejectionReason =
      action === 'reject' ? body.reason?.trim() || null : null;
    const outboxId = crypto.randomUUID();
    const changed = await sql`
      WITH updated AS (
        UPDATE appointments
        SET status = ${decision}, decided_at = now(),
            calendar_sync_status = ${action === 'approve' ? 'pending' : 'not_queued'},
            rejection_reason = ${rejectionReason}
        WHERE id = ${appointmentId} AND status = 'pending'
        RETURNING *
      ), queued AS (
        INSERT INTO calendar_sync_outbox (id, appointment_id)
        SELECT ${outboxId}::uuid, id FROM updated WHERE ${action === 'approve'}
        ON CONFLICT (appointment_id) WHERE status IN ('pending', 'processing') DO NOTHING
        RETURNING id
      )
      SELECT * FROM updated
    `;

    if (!changed[0]) {
      const existing =
        await sql`SELECT status FROM appointments WHERE id = ${appointmentId}`;
      if (!existing[0])
        return jsonResponse({ error: 'Appointment not found.' }, 404);
      return jsonResponse(
        { error: `Appointment is already ${existing[0].status}.` },
        409,
      );
    }

    const appointment = appointmentFromRow(changed[0]);
    let push = { queued: false };
    const internalToken = process.env.INTERNAL_FUNCTION_TOKEN;
    if (internalToken) {
      try {
        const backgroundUrl = new URL(
          '/.netlify/functions/push-notification-background',
          request.url,
        );
        const dispatch = await fetch(backgroundUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-function-token': internalToken,
          },
          body: JSON.stringify({ appointment, status: decision }),
          signal: AbortSignal.timeout(2500),
        });
        push = { queued: dispatch.status === 202 };
      } catch (error) {
        console.error(
          `Could not queue push notification for ${appointment.id}:`,
          error,
        );
      }
    } else {
      console.error(
        'INTERNAL_FUNCTION_TOKEN is not configured; push notification was not queued.',
      );
    }
    return jsonResponse({
      appointment,
      ...(action === 'approve' && { calendarSync: 'queued' }),
      push,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
