'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { continueConversation, toIdentity } = require('../src/lib/blip');
const { identify, enroll } = require('../src/lib/handlers');
const { FileStore } = require('../src/lib/store');
const { fakeFace, noisy } = require('./helpers');

const ID = '5511999990000';
const IDENTITY = `${ID}@wa.gw.msging.net`;

/** Fetch falso que registra as chamadas; `failCommands` simula status "failure" da Blip. */
function fakeFetch({ failCommands = false, httpError = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, auth: init.headers.Authorization, body });
    if (httpError) throw new Error('rede');
    if (url.endsWith('/commands')) {
      return { ok: true, status: 200, json: async () => ({ status: failCommands ? 'failure' : 'success' }) };
    }
    return { ok: true, status: 202 };
  };
  return { fetchImpl, calls };
}

const base = { BLIP_HTTP_URL: 'https://c.http.msging.net/', BLIP_KEY: 'KEY_BOT' };

test('toIdentity: número puro ganha o sufixo; identidade completa não muda; domínio configurável', () => {
  assert.equal(toIdentity(ID), IDENTITY);
  assert.equal(toIdentity(IDENTITY), IDENTITY);
  assert.equal(toIdentity(ID, { BLIP_IDENTITY_DOMAIN: 'outro.gw' }), `${ID}@outro.gw`);
});

test('estado + mensagem de texto: estado ANTES da mensagem, corpos no formato da Blip', async () => {
  const { fetchImpl, calls } = fakeFetch();
  const env = {
    ...base,
    BLIP_FLOW_ID: 'fluxo-123',
    BLIP_NEXT_STATE_ID: 'bloco-abc',
    BLIP_NEXT_MESSAGE: 'Olá, {nome}! Biometria confirmada. Qual o seu CPF?',
  };
  const r = await continueConversation({ env, fetchImpl, contactId: ID, name: 'Maria da Silva' });
  assert.deepEqual(r, { stateSet: true, messageSent: true });
  assert.equal(calls.length, 2);

  const [cmd, msg] = calls;
  assert.equal(cmd.url, 'https://c.http.msging.net/commands');
  assert.equal(cmd.body.to, 'postmaster@msging.net');
  assert.equal(cmd.body.method, 'set');
  assert.equal(cmd.body.uri, `/contexts/${IDENTITY}/stateid@fluxo-123`);
  assert.equal(cmd.body.type, 'text/plain');
  assert.equal(cmd.body.resource, 'bloco-abc');
  assert.match(cmd.body.id, /^[0-9a-f-]{36}$/);

  assert.equal(msg.url, 'https://c.http.msging.net/messages');
  assert.equal(msg.body.to, IDENTITY);
  assert.equal(msg.body.type, 'text/plain');
  assert.equal(msg.body.content, 'Olá, Maria! Biometria confirmada. Qual o seu CPF?');
  assert.equal(cmd.auth, 'Key KEY_BOT');
});

test('roteador + subbot: Master-State primeiro, depois o bloco, depois a mensagem; usa a chave do roteador', async () => {
  const { fetchImpl, calls } = fakeFetch();
  const env = {
    ...base,
    BLIP_ROUTER_KEY: 'KEY_ROUTER',
    BLIP_SUBBOT_ID: 'meusubbot@msging.net', // com sufixo já escrito: não duplica
    BLIP_FLOW_ID: 'fluxo-123',
    BLIP_NEXT_STATE_ID: 'bloco-abc',
    BLIP_NEXT_MESSAGE: 'Continuando...',
  };
  const r = await continueConversation({ env, fetchImpl, contactId: IDENTITY, name: 'Ana' });
  assert.deepEqual(r, { stateSet: true, messageSent: true });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].body.uri, `/contexts/${IDENTITY}/Master-State`);
  assert.equal(calls[0].body.resource, 'meusubbot@msging.net');
  assert.equal(calls[1].body.uri, `/contexts/${IDENTITY}/stateid@fluxo-123`);
  assert.equal(calls[2].url, 'https://c.http.msging.net/messages');
  assert.ok(calls.every((c) => c.auth === 'Key KEY_ROUTER'));
});

test('sem estado configurado: só a mensagem (botão Continuar por padrão)', async () => {
  const { fetchImpl, calls } = fakeFetch();
  const r = await continueConversation({ env: base, fetchImpl, contactId: ID, name: 'Ana' });
  assert.deepEqual(r, { stateSet: null, messageSent: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.content.interactive.action.buttons[0].reply.title, 'Continuar');
});

test('se o posicionamento do estado falhar, NÃO envia a mensagem', async () => {
  const { fetchImpl, calls } = fakeFetch({ failCommands: true });
  const env = { ...base, BLIP_FLOW_ID: 'f', BLIP_NEXT_STATE_ID: 'b', BLIP_NEXT_MESSAGE: 'oi' };
  const r = await continueConversation({ env, fetchImpl, contactId: ID, name: 'Ana' });
  assert.deepEqual(r, { stateSet: false, messageSent: false });
  assert.equal(calls.length, 1); // só o comando; nenhuma mensagem
});

test('Master-State falhando interrompe antes do bloco e da mensagem', async () => {
  const { fetchImpl, calls } = fakeFetch({ failCommands: true });
  const env = { ...base, BLIP_SUBBOT_ID: 's', BLIP_FLOW_ID: 'f', BLIP_NEXT_STATE_ID: 'b', BLIP_NEXT_MESSAGE: 'oi' };
  const r = await continueConversation({ env, fetchImpl, contactId: ID });
  assert.deepEqual(r, { stateSet: false, messageSent: false });
  assert.equal(calls.length, 1);
});

test('sem credenciais da Blip: não chama nada', async () => {
  const { fetchImpl, calls } = fakeFetch();
  const r = await continueConversation({ env: {}, fetchImpl, contactId: ID });
  assert.deepEqual(r, { stateSet: null, messageSent: false });
  assert.equal(calls.length, 0);
});

test('erro de rede não lança exceção', async () => {
  const { fetchImpl } = fakeFetch({ httpError: true });
  const env = { ...base, BLIP_FLOW_ID: 'f', BLIP_NEXT_STATE_ID: 'b' };
  assert.deepEqual(await continueConversation({ env, fetchImpl, contactId: ID }), { stateSet: false, messageSent: false });
  assert.deepEqual(await continueConversation({ env: base, fetchImpl, contactId: ID }), { stateSet: null, messageSent: false });
});

test('identify devolve stateSet e messageSent ao reconhecer o rosto', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faceid-'));
  const store = new FileStore(path.join(dir, 'f.json'));
  const face = fakeFace(21);
  await enroll(
    { id: ID, name: 'Ana Souza', consent: true, descriptors: [face, noisy(face, 1), noisy(face, 2)] },
    { store, env: { MATCH_THRESHOLD: '0.5' } }
  );

  const { fetchImpl, calls } = fakeFetch();
  const env = {
    MATCH_THRESHOLD: '0.5',
    ...base,
    BLIP_FLOW_ID: 'f',
    BLIP_NEXT_STATE_ID: 'b',
    BLIP_NEXT_MESSAGE: 'Oi {nome}',
  };
  const r = await identify({ id: ID, descriptor: noisy(face, 9) }, { store, env, fetchImpl });
  assert.equal(r.body.match, true);
  assert.equal(r.body.stateSet, true);
  assert.equal(r.body.messageSent, true);
  assert.equal(calls[1].body.content, 'Oi Ana');
  assert.ok(!JSON.stringify(r.body).includes('KEY_BOT'));
});
