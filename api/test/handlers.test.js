'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { identify, enroll } = require('../src/lib/handlers');
const { FileStore } = require('../src/lib/store');
const { signId } = require('../src/lib/security');
const { fakeFace, noisy } = require('./helpers');

function newStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faceid-'));
  return new FileStore(path.join(dir, 'faces.json'));
}

const ID = '5511999990000';
const baseEnv = { MATCH_THRESHOLD: '0.5' };

function samples(seed) {
  const face = fakeFace(seed);
  return [face, noisy(face, seed + 100), noisy(face, seed + 200)];
}

test('fluxo completo: não achou -> cadastra -> identifica', async () => {
  const store = newStore();
  const face = fakeFace(10);

  const first = await identify({ id: ID, descriptor: face }, { store, env: baseEnv });
  assert.equal(first.status, 200);
  assert.equal(first.body.match, false);

  const enr = await enroll(
    { id: ID, name: 'Maria Silva', consent: true, descriptors: samples(10) },
    { store, env: baseEnv }
  );
  assert.equal(enr.status, 201);

  const again = await identify({ id: ID, descriptor: noisy(face, 555) }, { store, env: baseEnv });
  assert.equal(again.body.match, true);
  assert.equal(again.body.name, 'Maria Silva');
  assert.equal(again.body.messageSent, false); // Blip não configurada no teste

  const stranger = await identify({ id: ID, descriptor: fakeFace(999) }, { store, env: baseEnv });
  assert.equal(stranger.body.match, false);
});

test('não guarda foto, só descritor e metadados', async () => {
  const store = newStore();
  await enroll({ id: ID, name: 'Ana', consent: true, descriptors: samples(5) }, { store, env: baseEnv });
  const [p] = await store.list();
  assert.deepEqual(Object.keys(p).sort(), ['consentAt', 'contactId', 'createdAt', 'descriptor', 'id', 'name']);
  assert.equal(p.descriptor.length, 128);
});

test('cadastro exige consentimento, nome e descritores válidos', async () => {
  const store = newStore();
  const ok = { id: ID, name: 'Ana', consent: true, descriptors: samples(1) };
  assert.equal((await enroll({ ...ok, consent: false }, { store, env: baseEnv })).status, 400);
  assert.equal((await enroll({ ...ok, name: 'A' }, { store, env: baseEnv })).status, 400);
  assert.equal((await enroll({ ...ok, descriptors: [] }, { store, env: baseEnv })).status, 400);
  assert.equal((await enroll({ ...ok, descriptors: [[1, 2, 3]] }, { store, env: baseEnv })).status, 400);
  assert.equal((await enroll({ ...ok, id: '../x' }, { store, env: baseEnv })).status, 400);
  assert.equal((await store.list()).length, 0);
});

test('mesmo rosto não é cadastrado duas vezes (409)', async () => {
  const store = newStore();
  const body = { id: ID, name: 'Ana', consent: true, descriptors: samples(3) };
  assert.equal((await enroll(body, { store, env: baseEnv })).status, 201);
  const dup = await enroll({ ...body, name: 'Outra', descriptors: samples(3) }, { store, env: baseEnv });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.name, 'Ana');
  assert.equal((await store.list()).length, 1);
});

test('LINK_SECRET: exige link assinado', async () => {
  const store = newStore();
  const env = { ...baseEnv, LINK_SECRET: 'segredo-de-teste' };
  const sig = signId(ID, env.LINK_SECRET);

  const noSig = await identify({ id: ID, descriptor: fakeFace(1) }, { store, env });
  assert.equal(noSig.status, 403);
  const wrong = await identify({ id: ID, sig: 'abc', descriptor: fakeFace(1) }, { store, env });
  assert.equal(wrong.status, 403);
  const otherId = await identify({ id: '5511888880000', sig, descriptor: fakeFace(1) }, { store, env });
  assert.equal(otherId.status, 403);
  const good = await identify({ id: ID, sig, descriptor: fakeFace(1) }, { store, env });
  assert.equal(good.status, 200);

  const enr = await enroll({ id: ID, name: 'Ana', consent: true, descriptors: samples(1) }, { store, env });
  assert.equal(enr.status, 403);
});

test('REQUIRE_SAME_CONTACT: rosto de outro contato não identifica', async () => {
  const store = newStore();
  await enroll({ id: ID, name: 'Ana', consent: true, descriptors: samples(8) }, { store, env: baseEnv });
  const env = { ...baseEnv, REQUIRE_SAME_CONTACT: 'true' };

  const mine = await identify({ id: ID, descriptor: noisy(fakeFace(8), 1) }, { store, env });
  assert.equal(mine.body.match, true);
  const other = await identify({ id: '5511777770000', descriptor: noisy(fakeFace(8), 1) }, { store, env });
  assert.equal(other.body.match, false);
  assert.equal(other.body.reason, 'other_contact');
});

test('envia mensagem à Blip no match, sem vazar chave na resposta', async () => {
  const store = newStore();
  await enroll({ id: ID, name: 'Ana', consent: true, descriptors: samples(4) }, { store, env: baseEnv });

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 202 };
  };
  const env = { ...baseEnv, BLIP_HTTP_URL: 'https://contrato.http.msging.net/', BLIP_KEY: 'TOKEN123' };

  const r = await identify({ id: ID, descriptor: noisy(fakeFace(4), 2) }, { store, env, fetchImpl });
  assert.equal(r.body.match, true);
  assert.equal(r.body.messageSent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://contrato.http.msging.net/messages');
  assert.equal(calls[0].init.headers.Authorization, 'Key TOKEN123');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.to, `${ID}@wa.gw.msging.net`); // número puro vira identidade do WhatsApp
  assert.equal(sent.content.interactive.action.buttons[0].reply.title, 'Continuar');
  assert.ok(!JSON.stringify(r.body).includes('TOKEN123'));

  // falha da Blip não derruba a identificação
  const failing = async () => { throw new Error('rede'); };
  const r2 = await identify({ id: ID, descriptor: noisy(fakeFace(4), 3) }, { store, env, fetchImpl: failing });
  assert.equal(r2.body.match, true);
  assert.equal(r2.body.messageSent, false);
});
