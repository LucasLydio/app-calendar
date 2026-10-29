import { jsonResponse } from './lib/http.mjs';

export default async function handler() {
  try {
    return jsonResponse({ status: 'ok' });
  } catch (error) {
    console.error('Health function error:', error);
    return jsonResponse(
      {
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}
