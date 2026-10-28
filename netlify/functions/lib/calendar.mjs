import crypto from 'node:crypto';

function deterministicEventId(appointmentId) {
  return crypto.createHash('sha256').update(appointmentId).digest('hex');
}

function escapeIcsText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function appointmentDateTime(appointment, durationMinutes, timeZone) {
  const [year, month, day] = appointment.date.split('-').map(Number);
  const [hour, minute] = appointment.time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let start = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(start))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    start +=
      target -
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      );
  }
  return {
    start: new Date(start),
    end: new Date(start + durationMinutes * 60_000),
  };
}

function icsDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function foldLine(line) {
  const chunks = [];
  let chunk = '';
  let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 75) {
      chunks.push(chunk);
      chunk = ` ${character}`;
      bytes = 1 + size;
    } else {
      chunk += character;
      bytes += size;
    }
  }
  chunks.push(chunk);
  return chunks.join('\r\n');
}

export function buildIcsCalendar(appointment, timeZone, durationMinutes) {
  const { start, end } = appointmentDateTime(appointment, durationMinutes, timeZone);
  const uid = `${deterministicEventId(appointment.id)}@app-calendar`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Appointment Manager//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${escapeIcsText(`${appointment.service} - ${appointment.name}`)}`,
    `DESCRIPTION:${escapeIcsText(`Appointment for ${appointment.name} (${appointment.email}).`)}`,
    `ATTENDEE;CN=${escapeIcsText(appointment.name)}:mailto:${appointment.email}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export function buildGoogleEventPayload(appointment, timeZone, durationMinutes) {
  const { start, end } = appointmentDateTime(appointment, durationMinutes, timeZone);
  return {
    id: deterministicEventId(appointment.id),
    summary: `${appointment.service} - ${appointment.name}`,
    description: `Appointment for ${appointment.name} (${appointment.email}).`,
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
    attendees: [{ email: appointment.email }],
  };
}

export function googleEventId(appointmentId) {
  return deterministicEventId(appointmentId);
}
