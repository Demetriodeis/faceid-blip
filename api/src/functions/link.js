'use strict';

const { app } = require('@azure/functions');
const { createLink } = require('../lib/handlers');

app.http('link', {
  methods: ['POST'],
  authLevel: 'anonymous', // protegida por x-api-key (LINK_API_KEY), checada no handler
  route: 'link',
  handler: async (request, context) => {
    try {
      const body = await request.json().catch(() => null);
      const res = createLink(body, request.headers.get('x-api-key'));
      return { status: res.status, jsonBody: res.body };
    } catch (err) {
      context.error('link falhou', err);
      return { status: 500, jsonBody: { error: 'internal_error' } };
    }
  },
});