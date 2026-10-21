'use strict';

const { app } = require('@azure/functions');
const { enroll } = require('../lib/handlers');
const { createStore } = require('../lib/store');

let store;

app.http('enroll', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'enroll',
  handler: async (request, context) => {
    try {
      store = store || createStore();
      const body = await request.json().catch(() => null);
      const res = await enroll(body, { store });
      return { status: res.status, jsonBody: res.body };
    } catch (err) {
      context.error('enroll falhou', err);
      return { status: 500, jsonBody: { error: 'internal_error' } };
    }
  },
});
