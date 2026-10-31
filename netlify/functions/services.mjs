import { desc, eq } from 'drizzle-orm';
import { services as servicesTable } from '../../db/schema.ts';
import { db } from './lib/db.mjs';
import { jsonResponse, readJson } from './lib/http.mjs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 120;
const MAX_PRICE = 1_000_000;
const MAX_DURATION_MINUTES = 1_440;

function requestError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function publicService(row) {
  if (
    !row ||
    typeof row.id !== 'string' ||
    typeof row.name !== 'string' ||
    !Number.isInteger(row.priceCents) ||
    !Number.isInteger(row.durationMinutes)
  ) {
    throw new Error('The database returned an invalid service record.');
  }
  return {
    id: row.id,
    name: row.name,
    price: Number((row.priceCents / 100).toFixed(2)),
    priceCents: row.priceCents,
    durationMinutes: row.durationMinutes,
    createdAt: row.createdAt ?? null,
  };
}

function validateService(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw requestError('Request body must be a JSON object.');
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw requestError(
      `name is required and must be ${MAX_NAME_LENGTH} characters or fewer.`,
    );
  }
  if (
    typeof body.price !== 'number' ||
    !Number.isFinite(body.price) ||
    body.price < 0 ||
    body.price > MAX_PRICE
  ) {
    throw requestError(`price must be a number between 0 and ${MAX_PRICE}.`);
  }
  const priceCents = Math.round(body.price * 100);
  if (Math.abs(body.price * 100 - priceCents) > Number.EPSILON * 100) {
    throw requestError('price may contain at most two decimal places.');
  }
  if (
    typeof body.durationMinutes !== 'number' ||
    !Number.isInteger(body.durationMinutes) ||
    body.durationMinutes < 1 ||
    body.durationMinutes > MAX_DURATION_MINUTES
  ) {
    throw requestError(
      `durationMinutes must be an integer between 1 and ${MAX_DURATION_MINUTES}.`,
    );
  }
  return { name, priceCents, durationMinutes: body.durationMinutes };
}

function requestId(request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    throw requestError('The request URL is invalid.');
  }
  const id = url.searchParams.get('id')?.trim();
  if (!id || !UUID_PATTERN.test(id)) {
    throw requestError('A valid service id query parameter is required.');
  }
  return id;
}

function isMissingServicesTable(error) {
  return error?.code === '42P01' || error?.cause?.code === '42P01';
}

function errorResponse(error, request) {
  const requestedStatus = Number.isInteger(error?.status) ? error.status : 500;
  const missingTable = isMissingServicesTable(error);
  const status = missingTable ? 503 : requestedStatus;
  const internalError = status >= 500;

  console.error('Services API error:', {
    method: request?.method,
    status,
    message: error instanceof Error ? error.message : String(error),
    code: error?.code || error?.cause?.code,
    stack: error?.stack,
    cause: error?.cause?.message,
  });

  return jsonResponse(
    {
      error:
        status === 503
          ? 'Service Unavailable'
          : internalError
            ? 'Internal Server Error'
            : 'Bad Request',
      message: missingTable
        ? 'Service storage is not available. Apply the services database migration and try again.'
        : internalError
          ? 'The request could not be completed.'
          : error.message,
    },
    status,
  );
}

export default async function handler(request) {
  try {
    if (request.method === 'GET') {
      const result = await db
        .select()
        .from(servicesTable)
        .orderBy(desc(servicesTable.createdAt));
      const rows = Array.isArray(result) ? result : [];
      return jsonResponse({ services: rows.map(publicService) });
    }

    if (request.method === 'POST') {
      const values = validateService(await readJson(request));
      const result = await db.insert(servicesTable).values(values).returning();
      const row = Array.isArray(result) ? result[0] : undefined;
      if (!row) throw new Error('The database did not return the created service.');
      return jsonResponse({ service: publicService(row) }, 201);
    }

    if (request.method === 'PUT') {
      const id = requestId(request);
      const values = validateService(await readJson(request));
      const result = await db
        .update(servicesTable)
        .set(values)
        .where(eq(servicesTable.id, id))
        .returning();
      const row = Array.isArray(result) ? result[0] : undefined;
      if (!row) {
        return jsonResponse(
          { error: 'Not Found', message: 'Service not found.' },
          404,
        );
      }
      return jsonResponse({ service: publicService(row) });
    }

    if (request.method === 'DELETE') {
      const id = requestId(request);
      const result = await db
        .delete(servicesTable)
        .where(eq(servicesTable.id, id))
        .returning({ id: servicesTable.id });
      const row = Array.isArray(result) ? result[0] : undefined;
      if (!row) {
        return jsonResponse(
          { error: 'Not Found', message: 'Service not found.' },
          404,
        );
      }
      return jsonResponse({ deleted: true, id: row.id });
    }

    return jsonResponse(
      { error: 'Method Not Allowed', message: 'Method not allowed.' },
      405,
      { Allow: 'GET, POST, PUT, DELETE' },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
