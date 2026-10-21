'use strict';

/**
 * Camada de armazenamento. Interface comum:
 *   list()            -> [{ id, name, contactId, descriptor, createdAt }]
 *   add(person)       -> grava/atualiza uma pessoa
 *
 * Drivers:
 *   - file:  JSON local, para desenvolvimento e testes
 *   - blip:  Bucket da Blip (um documento por pessoa, chave "faceid-<id>")
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const KEY_PREFIX = 'faceid-';

class FileStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async list() {
    return this._read();
  }

  async add(person) {
    const all = this._read().filter((p) => p.id !== person.id);
    all.push(person);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(all, null, 2));
  }
}

class BlipBucketStore {
  /**
   * @param {{baseUrl: string, key: string, fetchImpl?: typeof fetch, cacheMs?: number}} opts
   *   baseUrl: https://<contrato>.http.msging.net
   *   key:     token da chave de acesso (parte base64 depois de "Key ")
   */
  constructor({ baseUrl, key, fetchImpl, cacheMs = 30000 }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.key = key;
    this.fetch = fetchImpl || fetch;
    this.cacheMs = cacheMs;
    this._cache = null;
    this._cacheAt = 0;
  }

  async _command(body) {
    const res = await this.fetch(`${this.baseUrl}/commands`, {
      method: 'POST',
      headers: { Authorization: `Key ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: crypto.randomUUID(), ...body }),
    });
    if (!res.ok) throw new Error(`Blip /commands respondeu ${res.status}`);
    const json = await res.json();
    if (json.status && json.status !== 'success') {
      // status "failure" com reason.code 67 = documento não encontrado
      const err = new Error(`Blip command falhou: ${JSON.stringify(json.reason || json)}`);
      err.reason = json.reason;
      throw err;
    }
    return json;
  }

  async _listKeys() {
    const keys = [];
    const take = 100;
    for (let skip = 0; ; skip += take) {
      const json = await this._command({
        method: 'get',
        uri: `/buckets?$skip=${skip}&$take=${take}`,
      });
      const items = (json.resource && json.resource.items) || [];
      for (const it of items) {
        const k = typeof it === 'string' ? it : it && (it.id || it.key);
        if (k && String(k).startsWith(KEY_PREFIX)) keys.push(String(k));
      }
      if (items.length < take) break;
    }
    return keys;
  }

  async list() {
    if (this._cache && Date.now() - this._cacheAt < this.cacheMs) return this._cache;
    const keys = await this._listKeys();
    const people = [];
    // lotes pequenos para não estourar limite de requisições
    for (let i = 0; i < keys.length; i += 10) {
      const batch = keys.slice(i, i + 10);
      const docs = await Promise.all(
        batch.map((k) =>
          this._command({ method: 'get', uri: `/buckets/${encodeURIComponent(k)}` })
            .then((j) => j.resource)
            .catch(() => null)
        )
      );
      for (const d of docs) if (d && d.descriptor) people.push(d);
    }
    this._cache = people;
    this._cacheAt = Date.now();
    return people;
  }

  async add(person) {
    await this._command({
      method: 'set',
      uri: `/buckets/${encodeURIComponent(KEY_PREFIX + person.id)}`,
      type: 'application/json',
      resource: person,
    });
    this._cache = null; // força releitura na próxima identificação
  }
}

function createStore(env = process.env) {
  const driver = (env.STORE_DRIVER || 'file').toLowerCase();
  if (driver === 'blip') {
    if (!env.BLIP_HTTP_URL || !env.BLIP_KEY) {
      throw new Error('STORE_DRIVER=blip exige BLIP_HTTP_URL e BLIP_KEY');
    }
    return new BlipBucketStore({ baseUrl: env.BLIP_HTTP_URL, key: env.BLIP_KEY });
  }
  return new FileStore(env.FILE_STORE_PATH || path.join(process.cwd(), '.data', 'faces.json'));
}

module.exports = { FileStore, BlipBucketStore, createStore, KEY_PREFIX };
