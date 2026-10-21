'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLink, identify } = require('../src/lib/handlers');
const { FileStore } = require('../src/lib/store');
const { fakeFace } = require('./helpers');

const env = {
  LINK_API_KEY: 'chave-api-de-teste',
  LINK_SECRET: 'segredo-de-teste',
  PUBLIC_BASE_URL: 'https://meu-site.azurestaticapps.net/',
};

test('createLink devolve url assinada (id simples)', () => {
  const r = createLink({ id: '5511999990000' }, env.LINK_API_KEY, env);
  assert.equal(r.status, 200);
  assert.match(r.body.sig, /^[0-9a-f]{64}$/);
  assert.equal(r.body.url, `https://meu-site.azurestaticapps.net/?id=5511999990000&sig=${r.body.sig}`);
});

test('a url gerada passa na validação do identify, inclusive com identity da Blip (@)', async () => {
  const id = '5511999990000@wa.gw.msging.net';
  const r = createLink({ id }, env.LINK_API_KEY, env);
  assert.equal(r.status, 200);

  // simula o que o front faz: lê id e sig da query string
  const params = new URL(r.body.url).searchParams;
  assert.equal(params.get('id'), id);

  const store = new FileStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'faceid-')), 'f.json'));
  const ok = await identify({ id: params.get('id'), sig: params.get('sig'), descriptor: fakeFace(1) }, { store, env });
  assert.equal(ok.status, 200);

  const adulterado = await identify({ id: '5511000000000@wa.gw.msging.net', sig: params.get('sig'), descriptor: fakeFace(1) }, { store, env });
  assert.equal(adulterado.status, 403);
});

test('createLink recusa chave errada ou ausente (401)', () => {
  assert.equal(createLink({ id: '5511999990000' }, 'errada', env).status, 401);
  assert.equal(createLink({ id: '5511999990000' }, null, env).status, 401);
  assert.equal(createLink({ id: '5511999990000' }, '', env).status, 401);
});

test('createLink valida o id (400)', () => {
  assert.equal(createLink({ id: '../x' }, env.LINK_API_KEY, env).status, 400);
  assert.equal(createLink({}, env.LINK_API_KEY, env).status, 400);
  assert.equal(createLink(null, env.LINK_API_KEY, env).status, 400);
});

test('createLink fica desativada (503) se faltar configuração', () => {
  for (const missing of ['LINK_API_KEY', 'LINK_SECRET', 'PUBLIC_BASE_URL']) {
    const partial = { ...env };
    delete partial[missing];
    assert.equal(createLink({ id: '5511999990000' }, env.LINK_API_KEY, partial).status, 503, missing);
  }
});
