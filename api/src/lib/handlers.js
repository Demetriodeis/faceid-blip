'use strict';

const { isDescriptor, averageDescriptors, findBestMatch } = require('./match');
const { verifyLink, validContactId } = require('./security');
const { sendContinueMessage } = require('./blip');

const MAX_SAMPLES = 8;

function threshold(env) {
  const t = Number(env.MATCH_THRESHOLD);
  return Number.isFinite(t) && t > 0 ? t : 0.5;
}

function checkLink(body, env) {
  if (!body || !validContactId(body.id)) return { status: 400, body: { error: 'invalid_id' } };
  if (!verifyLink(body.id, body.sig, env.LINK_SECRET)) {
    return { status: 403, body: { error: 'invalid_signature' } };
  }
  return null;
}

/**
 * POST /api/identify  { id, sig?, descriptor }
 * -> { match: true, name, distance, messageSent } | { match: false, distance }
 */
async function identify(body, { store, env = process.env, fetchImpl }) {
  const bad = checkLink(body, env);
  if (bad) return bad;
  if (!isDescriptor(body.descriptor)) return { status: 400, body: { error: 'invalid_descriptor' } };

  const people = await store.list();
  const result = findBestMatch(body.descriptor, people, threshold(env));

  if (!result.match) {
    return { status: 200, body: { match: false, distance: result.distance } };
  }

  const sameContact = result.person.contactId === body.id;
  if (String(env.REQUIRE_SAME_CONTACT).toLowerCase() === 'true' && !sameContact) {
    // rosto conhecido, mas pertence a outro contato: trata como não identificado
    return { status: 200, body: { match: false, distance: result.distance, reason: 'other_contact' } };
  }

  const messageSent = await sendContinueMessage({
    env,
    fetchImpl,
    contactId: body.id,
    name: result.person.name,
  });
  return {
    status: 200,
    body: { match: true, name: result.person.name, distance: result.distance, sameContact, messageSent },
  };
}

/**
 * POST /api/enroll  { id, sig?, name, consent: true, descriptors: [[128], ...] }
 * -> 201 { enrolled: true } | 409 { error: 'already_enrolled', name }
 */
async function enroll(body, { store, env = process.env }) {
  const bad = checkLink(body, env);
  if (bad) return bad;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 80) return { status: 400, body: { error: 'invalid_name' } };
  if (body.consent !== true) return { status: 400, body: { error: 'consent_required' } };

  const list = body.descriptors;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_SAMPLES || !list.every(isDescriptor)) {
    return { status: 400, body: { error: 'invalid_descriptors' } };
  }

  const descriptor = averageDescriptors(list);

  // evita cadastrar o mesmo rosto duas vezes
  const people = await store.list();
  const existing = findBestMatch(descriptor, people, threshold(env));
  if (existing.match) {
    return { status: 409, body: { error: 'already_enrolled', name: existing.person.name } };
  }

  const person = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    contactId: body.id,
    descriptor,
    consentAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  await store.add(person);
  return { status: 201, body: { enrolled: true } };
}

module.exports = { identify, enroll };
