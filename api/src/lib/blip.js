'use strict';

const crypto = require('node:crypto');

/**
 * Continuação do atendimento na Blip, feita pelo servidor (a chave nunca vai ao navegador):
 *   1. (opcional) posiciona o usuário num bloco do fluxo  -> comando `set /contexts/.../stateid@<fluxo>`
 *      (com `Master-State` antes, só se usar roteador + subbot)
 *   2. envia a próxima mensagem do bot (texto simples configurável, ou o botão "Continuar")
 *
 * Observação da Blip: ao posicionar o usuário, o conteúdo do bloco de destino NÃO é exibido;
 * só as saídas/ações dele rodam depois da próxima resposta do usuário. Por isso o passo 2
 * envia a mensagem, e o bloco de destino deve ser um bloco de entrada (sem mensagens)
 * cuja condição de saída trata a resposta.
 */

const DEFAULT_DOMAIN = 'wa.gw.msging.net';

const baseUrl = (env) => env.BLIP_HTTP_URL.replace(/\/$/, '');
/** Chave do bot que está no canal (roteador, se houver); senão a própria BLIP_KEY. */
const channelKey = (env) => env.BLIP_ROUTER_KEY || env.BLIP_KEY;

/** "5511999990000" -> "5511999990000@wa.gw.msging.net"; identidades completas ficam como estão. */
function toIdentity(id, env = process.env) {
  const s = String(id);
  return s.includes('@') ? s : `${s}@${env.BLIP_IDENTITY_DOMAIN || DEFAULT_DOMAIN}`;
}

async function blipCommand({ env, fetchImpl, body }) {
  const res = await (fetchImpl || fetch)(`${baseUrl(env)}/commands`, {
    method: 'POST',
    headers: { Authorization: `Key ${channelKey(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: crypto.randomUUID(), to: 'postmaster@msging.net', ...body }),
  });
  if (!res.ok) return false;
  let json = {};
  try { json = await res.json(); } catch { /* corpo vazio */ }
  return !json.status || json.status === 'success';
}

/**
 * Move o usuário para o bloco configurado.
 * @returns {Promise<boolean|null>} null = não configurado, true/false = resultado
 */
async function positionUser({ env, fetchImpl, identity }) {
  if (!env.BLIP_FLOW_ID || !env.BLIP_NEXT_STATE_ID) return null;
  try {
    if (env.BLIP_SUBBOT_ID) {
      const subbot = String(env.BLIP_SUBBOT_ID).replace(/@msging\.net$/, '');
      const ok = await blipCommand({
        env,
        fetchImpl,
        body: {
          method: 'set',
          uri: `/contexts/${identity}/Master-State`,
          type: 'text/plain',
          resource: `${subbot}@msging.net`,
        },
      });
      if (!ok) return false;
    }
    return await blipCommand({
      env,
      fetchImpl,
      body: {
        method: 'set',
        uri: `/contexts/${identity}/stateid@${env.BLIP_FLOW_ID}`,
        type: 'text/plain',
        resource: env.BLIP_NEXT_STATE_ID,
      },
    });
  } catch {
    return false;
  }
}

function buildMessage({ env, identity, name }) {
  const id = crypto.randomUUID();
  if (env.BLIP_NEXT_MESSAGE) {
    const firstName = name ? String(name).trim().split(/\s+/)[0] : '';
    return { id, to: identity, type: 'text/plain', content: env.BLIP_NEXT_MESSAGE.replace(/\{nome\}/gi, firstName) };
  }
  // padrão: botão "Continuar" (mesmo payload do protótipo original)
  return {
    id,
    to: identity,
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
}

async function sendMessage({ env, fetchImpl, identity, name }) {
  try {
    const res = await (fetchImpl || fetch)(`${baseUrl(env)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Key ${channelKey(env)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildMessage({ env, identity, name })),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Chamado quando o rosto é reconhecido.
 * Se o posicionamento do estado estiver configurado e falhar, NÃO envia a mensagem
 * (ela levaria a resposta do usuário para o bloco errado).
 * @returns {{stateSet: boolean|null, messageSent: boolean}}
 */
async function continueConversation({ env = process.env, fetchImpl, contactId, name }) {
  if (!env.BLIP_HTTP_URL || !channelKey(env)) return { stateSet: null, messageSent: false };
  const identity = toIdentity(contactId, env);

  const stateSet = await positionUser({ env, fetchImpl, identity });
  if (stateSet === false) return { stateSet: false, messageSent: false };

  const messageSent = await sendMessage({ env, fetchImpl, identity, name });
  return { stateSet, messageSent };
}

module.exports = { continueConversation, toIdentity, buildMessage };
