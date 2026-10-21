'use strict';

const { app } = require('@azure/functions');
const { identify } = require('../lib/handlers');
const { createStore } = require('../lib/store');

let store;

app.http('identify', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'identify',
  handler: async (request, context) => {
    try {
      store = store || createStore();
      const body = await request.json().catch(() => null);
      const res = await identify(body, { store });
      return { status: res.status, jsonBody: res.body };
    } catch (err) {
      context.error('identify falhou', err);
      return { status: 500, jsonBody: { error: 'internal_error' } };
    }
  },
});
