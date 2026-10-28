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
    throw Object.assign(new Error('Invalid JSON request body.'), { status: 400 });
  }
}

export function errorResponse(error) {
  if (error?.code === '23505') {
    return jsonResponse(
      { error: 'That time was just booked. Please choose another available time.' },
      409,
    );
  }
  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (status >= 500) console.error(error);
  return jsonResponse(
    { error: status >= 500 ? 'Internal server error.' : error.message },
    status,
  );
}

export function routeNotFound() {
  return jsonResponse({ error: 'Route not found.' }, 404);
}
