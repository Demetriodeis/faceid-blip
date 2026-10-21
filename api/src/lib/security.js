'use strict';

const crypto = require('node:crypto');

/**
 * Assinatura opcional do link (?id=...&sig=...).
 * Se LINK_SECRET estiver configurada, só links assinados com
 * HMAC-SHA256(id) em hexadecimal são aceitos. Isso impede que alguém
 * troque o `id` na URL para cadastrar ou disparar mensagens para
 * contatos que não são dele.
 */
function signId(id, secret) {
  return crypto.createHmac('sha256', secret).update(String(id)).digest('hex');
}

function verifyLink(id, sig, secret) {
  if (!secret) return true; // proteção desligada (ok só em dev/demo)
  if (typeof sig !== 'string' || !sig) return false;
  const expected = Buffer.from(signId(id, secret));
  const received = Buffer.from(sig);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function validContactId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9@._:+-]{3,128}$/.test(id);
}

/** Comparação de strings em tempo constante (para chaves de API). */
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { signId, verifyLink, validContactId };
