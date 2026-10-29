export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export async function readJson(request) {
  try {
    const body = await request.text();
    return body ? JSON.parse(body) : {};
  } catch {
    throw Object.assign(new Error('Invalid JSON request body.'), {
      status: 400,
    });
  }
}

export function errorResponse(error) {
  if (error?.code === '23505' || error?.cause?.code === '23505') {
    return jsonResponse(
      {
        error:
          'That time was just booked. Please choose another available time.',
      },
      409,
    );
  }
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const message = error instanceof Error ? error.message : String(error);
  if (status >= 500) {
    console.error('Netlify function error:', {
      message,
      code: error?.code || error?.cause?.code,
      cause: error?.cause?.message,
      stack: error?.stack,
      causeStack: error?.cause?.stack,
    });
  }
  return jsonResponse(
    {
      error: status >= 500 ? 'Internal Server Error' : 'Request Error',
      message: status >= 500 ? 'The request could not be completed.' : message,
    },
    status,
  );
}

export function routeNotFound() {
  return jsonResponse({ error: 'Route not found.' }, 404);
}
