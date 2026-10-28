import { buildIcsCalendar } from './lib/calendar.mjs';
import { appointmentFromRow, getAvailability, getSql } from './lib/db.mjs';
import { errorResponse, jsonResponse } from './lib/http.mjs';

export default async function handler(request) {
  try {
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed.' }, 405, {
        Allow: 'GET',
      });
    }
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return jsonResponse({ error: 'Appointment ID is required.' }, 400);
    const sql = getSql();
    const rows = await sql`SELECT * FROM appointments WHERE id = ${id}`;
    if (!rows[0]) return jsonResponse({ error: 'Appointment not found.' }, 404);
    if (rows[0].status !== 'approved') {
      return jsonResponse(
        { error: 'Only approved appointments can be exported.' },
        409,
      );
    }

    const appointment = appointmentFromRow(rows[0]);
    const availability = await getAvailability(sql);
    const content = buildIcsCalendar(
      appointment,
      availability.timeZone,
      Number(process.env.CALENDAR_APPOINTMENT_DURATION_MINUTES) || 60,
    );
    const filename = appointment.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.ics"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
