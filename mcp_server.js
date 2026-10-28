'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const {
  StdioServerTransport,
} = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const API_BASE_URL = (
  process.env.APPOINTMENT_API_URL || 'http://localhost:3000/api'
).replace(/\/$/, '');

const tools = [
  {
    name: 'review_appointment',
    description: 'Approve or reject a pending appointment.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The appointment ID to review.',
        },
        decision: {
          type: 'string',
          enum: ['approve', 'reject'],
          description: 'The manager decision for this appointment.',
        },
        reason: {
          type: 'string',
          description: 'Optional reason to include when rejecting.',
        },
      },
      required: ['id', 'decision'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_availability',
    description: 'Replace the manager weekly availability schedule.',
    inputSchema: {
      type: 'object',
      properties: {
        timeZone: {
          type: 'string',
          description: 'IANA time zone name, such as Europe/Lisbon.',
        },
        weeklySlots: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              day: {
                type: 'string',
                enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
              },
              start: {
                type: 'string',
                pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
                description: 'Start time in 24-hour HH:mm format.',
              },
              end: {
                type: 'string',
                pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
                description: 'End time in 24-hour HH:mm format.',
              },
            },
            required: ['day', 'start', 'end'],
            additionalProperties: false,
          },
        },
      },
      required: ['timeZone', 'weeklySlots'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_pending_appointments',
    description: 'List appointments waiting for manager review.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

class ApiError extends Error {
  constructor(status, payload) {
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Appointment API returned HTTP ${status}.`;
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function requestApi(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers:
      options.body === undefined
        ? undefined
        : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const responseText = await response.text();
  let payload;

  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = {
      error:
        responseText || `Appointment API returned HTTP ${response.status}.`,
    };
  }

  if (!response.ok) {
    throw new ApiError(response.status, payload);
  }

  return payload;
}

function successResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(error) {
  const details = {
    error: error.message || 'The appointment API request failed.',
  };
  if (error.status !== undefined) details.status = error.status;
  if (error.payload !== undefined) details.details = error.payload;

  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(details, null, 2) }],
  };
}

async function runTool(name, args = {}) {
  switch (name) {
    case 'review_appointment': {
      const action = args.decision === 'approve' ? 'approve' : 'reject';
      const body =
        action === 'reject' && typeof args.reason === 'string'
          ? { reason: args.reason }
          : undefined;
      return requestApi(
        `/appointments/${encodeURIComponent(args.id)}/${action}`,
        { method: 'POST', body },
      );
    }
    case 'set_availability':
      return requestApi('/availability', {
        method: 'PUT',
        body: {
          timeZone: args.timeZone,
          weeklySlots: args.weeklySlots,
        },
      });
    case 'list_pending_appointments':
      return requestApi('/appointments?status=pending');
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: 'appointment-management', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await runTool(
      request.params.name,
      request.params.arguments || {},
    );
    return successResult(result);
  } catch (error) {
    return errorResult(error);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('MCP server failed to start:', error);
  process.exitCode = 1;
});
