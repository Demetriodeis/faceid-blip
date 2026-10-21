'use strict';

const crypto = require('node:crypto');

/**
 * Envia ao contato a mensagem interativa de continuação do fluxo
 * (mesmo payload do protótipo original, agora a partir do servidor —
 * a chave da Blip nunca vai para o navegador).
 */
async function sendContinueMessage({ env = process.env, fetchImpl, contactId, name }) {
  if (!env.BLIP_HTTP_URL || !env.BLIP_KEY) return false;
  const doFetch = fetchImpl || fetch;
  const payload = {
    id: crypto.randomUUID(),
    to: contactId,
    type: 'application/json',
    content: {
      recipient_type: 'individual',
      type: 'interactive',
      interactive: {
        type: 'button',
        header: { type: 'text', text: 'Biometria Facial' },
        body: { text: name ? `Tudo certo, ${name}! Biometria facial confirmada ✅` : 'Biometria facial confirmada ✅' },
        footer: { text: 'Clique na opção abaixo para continuar sua jornada' },
        action: { buttons: [{ type: 'reply', reply: { id: '1', title: 'Continuar' } }] },
      },
    },
  };
  try {
    const res = await doFetch(`${env.BLIP_HTTP_URL.replace(/\/$/, '')}/messages`, {
      method: 'POST',
      headers: { Authorization: `Key ${env.BLIP_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = { sendContinueMessage };
