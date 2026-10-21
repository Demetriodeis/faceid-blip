'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BlipBucketStore, createStore, FileStore } = require('../src/lib/store');
const { fakeFace } = require('./helpers');

/** Simula o endpoint /commands da Blip só para validar o formato das chamadas. */
function fakeBlip() {
  const docs = new Map();
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, auth: init.headers.Authorization, body });
    const reply = (resource) => ({ ok: true, status: 200, json: async () => ({ status: 'success', resource }) });

    if (body.method === 'set') {
      const key = decodeURIComponent(body.uri.replace('/buckets/', ''));
      docs.set(key, body.resource);
      return reply();
    }
    if (body.method === 'get' && body.uri.startsWith('/buckets?')) {
      const u = new URL('http://x' + body.uri);
      const skip = Number(u.searchParams.get('$skip'));
      const take = Number(u.searchParams.get('$take'));
      return reply({ items: [...docs.keys(), 'outra-chave'].slice(skip, skip + take) });
    }
    if (body.method === 'get' && body.uri.startsWith('/buckets/')) {
      const key = decodeURIComponent(body.uri.replace('/buckets/', ''));
      return docs.has(key)
        ? reply(docs.get(key))
        : { ok: true, status: 200, json: async () => ({ status: 'failure', reason: { code: 67 } }) };
    }
    return { ok: false, status: 400, json: async () => ({}) };
  };
  return { fetchImpl, calls, docs };
}

test('BlipBucketStore grava e lista pessoas por chave faceid-<id>', async () => {
  const { fetchImpl, calls, docs } = fakeBlip();
  const store = new BlipBucketStore({ baseUrl: 'https://c.http.msging.net/', key: 'K', fetchImpl });

  await store.add({ id: 'a1', name: 'Ana', contactId: '551', descriptor: fakeFace(1) });
  await store.add({ id: 'b2', name: 'Bia', contactId: '552', descriptor: fakeFace(2) });
  assert.deepEqual([...docs.keys()].sort(), ['faceid-a1', 'faceid-b2']);
  assert.equal(calls[0].url, 'https://c.http.msging.net/commands');
  assert.equal(calls[0].auth, 'Key K');
  assert.equal(calls[0].body.method, 'set');
  assert.equal(calls[0].body.type, 'application/json');

  const people = await store.list();
  assert.deepEqual(people.map((p) => p.name).sort(), ['Ana', 'Bia']); // ignora "outra-chave"
});

test('BlipBucketStore usa cache e invalida após add', async () => {
  const { fetchImpl, calls } = fakeBlip();
  const store = new BlipBucketStore({ baseUrl: 'https://c.http.msging.net', key: 'K', fetchImpl });
  await store.add({ id: 'a1', name: 'Ana', contactId: '551', descriptor: fakeFace(1) });

  await store.list();
  const after1 = calls.length;
  await store.list(); // cache
  assert.equal(calls.length, after1);

  await store.add({ id: 'b2', name: 'Bia', contactId: '552', descriptor: fakeFace(2) });
  assert.equal((await store.list()).length, 2);
});

test('createStore escolhe o driver pelo ambiente', () => {
  assert.ok(createStore({ STORE_DRIVER: 'file', FILE_STORE_PATH: '/tmp/x.json' }) instanceof FileStore);
  assert.ok(createStore({ STORE_DRIVER: 'blip', BLIP_HTTP_URL: 'https://c', BLIP_KEY: 'k' }) instanceof BlipBucketStore);
  assert.throws(() => createStore({ STORE_DRIVER: 'blip' }), /BLIP_HTTP_URL/);
});
