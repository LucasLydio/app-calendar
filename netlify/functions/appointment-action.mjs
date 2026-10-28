import { and, eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import { appointments, calendarOutbox } from '../../db/schema.ts';
import { appointmentFromRow, db } from './lib/db.mjs';
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
    const decision = action === 'approve' ? 'approved' : 'rejected';
    const rejectionReason =
      action === 'reject' ? body.reason?.trim() || null : null;
    const outboxId = crypto.randomUUID();
    const changed = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(appointments)
        .set({
          status: decision,
          decidedAt: new Date(),
          calendarSyncStatus: action === 'approve' ? 'pending' : 'not_queued',
          rejectionReason,
        })
        .where(
          and(
            eq(appointments.id, appointmentId),
            eq(appointments.status, 'pending'),
          ),
        )
        .returning();
      if (updated && action === 'approve') {
        await tx.insert(calendarOutbox).values({
          id: outboxId,
          appointmentId: updated.id,
          action: 'create',
        });
      }
      return updated;
    });

    if (!changed) {
      const [existing] = await db
        .select({ status: appointments.status })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1);
      if (!existing)
        return jsonResponse({ error: 'Appointment not found.' }, 404);
      return jsonResponse(
        { error: `Appointment is already ${existing.status}.` },
        409,
      );
    }

    const appointment = appointmentFromRow(changed);
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
