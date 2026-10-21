'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isDescriptor, euclidean, averageDescriptors, findBestMatch } = require('../src/lib/match');
const { fakeFace, noisy } = require('./helpers');

test('isDescriptor valida tamanho e valores numéricos', () => {
  assert.equal(isDescriptor(fakeFace(1)), true);
  assert.equal(isDescriptor(fakeFace(1).slice(1)), false);
  assert.equal(isDescriptor([...fakeFace(1).slice(1), NaN]), false);
  assert.equal(isDescriptor('x'), false);
  assert.equal(isDescriptor(null), false);
});

test('euclidean: zero para iguais e simétrica', () => {
  const a = fakeFace(1);
  const b = fakeFace(2);
  assert.equal(euclidean(a, a), 0);
  assert.equal(euclidean(a, b), euclidean(b, a));
});

test('averageDescriptors fica entre as capturas', () => {
  const a = new Array(128).fill(0);
  const b = new Array(128).fill(1);
  const avg = averageDescriptors([a, b]);
  assert.ok(avg.every((v) => v === 0.5));
});

test('findBestMatch acha a mesma pessoa e rejeita desconhecidos', () => {
  const people = [1, 2, 3].map((s) => ({ id: `p${s}`, name: `Pessoa ${s}`, descriptor: fakeFace(s) }));

  const same = findBestMatch(noisy(fakeFace(2), 99), people, 0.5);
  assert.equal(same.match, true);
  assert.equal(same.person.id, 'p2');
  assert.ok(same.distance < 0.1);

  const stranger = findBestMatch(fakeFace(777), people, 0.5);
  assert.equal(stranger.match, false);
  assert.ok(stranger.distance > 0.5);
});

test('findBestMatch com base vazia', () => {
  const r = findBestMatch(fakeFace(1), [], 0.5);
  assert.deepEqual(r, { match: false, person: null, distance: null });
});
