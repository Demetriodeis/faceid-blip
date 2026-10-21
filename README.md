# FaceID Blip (MVP)

Identificação facial para o fluxo da Blip, sem serviços externos pagos.

**Fluxo:** o contato abre o link do WhatsApp → o rosto é lido → se está na base, confirma e dispara a mensagem de continuação; se não está, vai para o **cadastro** (nome + consentimento + 3 capturas) e depois **refaz a leitura** automaticamente.

## Como funciona

```
Navegador (web/)                          Azure Function (api/)              Blip
 face-api.js (TensorFlow.js)  ── 128 números ──►  /api/identify  ──► Bucket (faceid-<id>)
 detecta o rosto e calcula o                      compara (distância)  ──► /messages (continuação)
 descritor NO aparelho                            /api/enroll     ──► grava no Bucket
```

- **Nenhuma foto sai do aparelho nem é guardada.** Só o descritor (128 números) é enviado e armazenado.
- A comparação é distância euclidiana entre descritores (limiar `MATCH_THRESHOLD`, padrão `0.5`).
- Cadastrar alguém novo **não exige retreino**: é só gravar o vetor.
- A chave da Blip fica só nas *Application Settings* da Function — nunca no HTML.
- Backend do TensorFlow.js: WebGL → WASM → CPU (os `.wasm` já estão em `web/lib/`).

## Estrutura

```
web/                      front estático (Static Web Apps)
  index.html, app.js, config.js
  lib/                    face-api.js (TF.js 4.22) + binários .wasm
  models/                 pesos: tiny face detector, landmarks tiny, face recognition (~6,7 MB)
  staticwebapp.config.json
api/                      Azure Functions (Node 20, modelo v4)
  src/functions/          identify.js, enroll.js, link.js
  src/lib/                match, store (Blip Bucket / arquivo), blip, handlers, security
  test/                   20 testes (node --test)
```

## Variáveis de ambiente (Application Settings da Function)

| Nome | Para quê |
|---|---|
| `STORE_DRIVER` | `blip` (Bucket da Blip) ou `file` (JSON local, só dev) |
| `BLIP_HTTP_URL` | `https://<contrato>.http.msging.net` |
| `BLIP_KEY` | token da chave de acesso (a parte base64 depois de `Key `) |
| `MATCH_THRESHOLD` | distância máxima para considerar "mesma pessoa" (padrão `0.5`) |
| `LINK_SECRET` | se definida, só links assinados (`&sig=`) são aceitos — **recomendado** |
| `REQUIRE_SAME_CONTACT` | `true` = o rosto só identifica se pertence ao contato do link |
| `LINK_API_KEY` | chave que o bot usa para chamar `/api/link` (header `x-api-key`). **Diferente** do `LINK_SECRET` |
| `PUBLIC_BASE_URL` | endereço público do site, ex.: `https://<site>.azurestaticapps.net` |

### Link assinado (recomendado)

Sem `LINK_SECRET`, qualquer pessoa pode trocar o `id` na URL, cadastrar rostos para outros contatos e disparar mensagens do seu bot para qualquer número. Com ela, o link vira `https://<site>/?id=<contato>&sig=<hmac>`:

```js
// sig = HMAC-SHA256(id) em hexadecimal
require('node:crypto').createHmac('sha256', LINK_SECRET).update(id).digest('hex');
```

Esse cálculo nunca acontece no navegador. Para teste manual use o comando acima; no fluxo real, quem gera o link é a rota `/api/link` (próxima seção).

### Gerar o link assinado dentro da Blip (`/api/link`)

O script da Blip não é o lugar para calcular HMAC. Em vez disso, o bot chama a Function e recebe o link pronto.

1. No Azure, cadastre `LINK_API_KEY` (valor aleatório, gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), `LINK_SECRET` e `PUBLIC_BASE_URL`. Sem as três, a rota responde `503`.
2. No Builder, antes do passo que envia o link, adicione um bloco de **chamada HTTP** (integração):
   - Método **POST**, URL `https://<seu-site>.azurestaticapps.net/api/link`
   - Headers: `Content-Type: application/json` e `x-api-key: <LINK_API_KEY>`
   - Body: `{"id":"{{contact.identity}}"}`
3. Resposta: `{ "url": "https://.../?id=...&sig=...", "sig": "..." }`. Guarde o campo `url` numa variável (por exemplo `linkFaceId`) e use essa variável no botão ou na mensagem enviada ao contato.
4. Se a resposta chegar como texto, um bloco de **script** (ES6) extrai o campo:

```js
function run(resposta) {
  const dados = typeof resposta === 'string' ? JSON.parse(resposta) : resposta;
  return dados.url;
}
```

Os nomes exatos dos campos e variáveis do Builder podem variar conforme a sua versão da interface; o que importa é enviar o `id` no corpo, o header `x-api-key` e ler o campo `url` da resposta. Guarde a `LINK_API_KEY` como variável de configuração do bot, nunca em texto visível ao contato.

Exemplo de teste da rota:

```bash
curl -X POST https://<seu-site>.azurestaticapps.net/api/link \
  -H "Content-Type: application/json" -H "x-api-key: <LINK_API_KEY>" \
  -d '{"id":"5511999990000"}'
```

## Rodar local

Requisitos: Node 20+, `npm i -g @azure/static-web-apps-cli azure-functions-core-tools@4`.

```bash
cd api
npm install
cp local.settings.sample.json local.settings.json   # STORE_DRIVER=file já vem configurado
cd ..
swa start web --api-location api
# abra http://localhost:4280/?id=5511999990000
```

A câmera exige HTTPS ou `localhost`. Testes da API: `cd api && npm test`.

## Deploy (Azure Static Web Apps — plano Free)

1. No portal do Azure: **Criar recurso → Static Web App**, plano **Free**, origem **GitHub**, escolha o repositório e a branch.
2. *Build presets*: **Custom**. `App location`: `web` · `Api location`: `api` · `Output location`: vazio.
3. Em **Configuration → Application settings**, cadastre as variáveis da tabela acima (`STORE_DRIVER=blip`, `BLIP_HTTP_URL`, `BLIP_KEY`, `LINK_SECRET`...).
4. O link do bot passa a ser `https://<seu-site>.azurestaticapps.net/?id=<contato>&sig=<assinatura>`.

Confira os limites do plano Free no portal antes de usar em volume.

## Subir o projeto no GitHub pelo VS Code

1. Abra a pasta `faceid-blip` no VS Code.
2. **Source Control** (`Ctrl+Shift+G`) → **Initialize Repository** (ou **Publish to GitHub**).
3. Confira a lista de alterações: `local.settings.json` e `node_modules` **não** devem aparecer (o `.gitignore` já os ignora).
4. Passe o mouse em **Changes** e clique em **+** (Stage All Changes).
5. Escreva a mensagem (ex.: `MVP faceid blip`) e clique em **Commit**.
6. Clique em **Publish Branch** (ou **Sync Changes**) para enviar ao GitHub.

## Limites conhecidos do MVP

- **Sem prova de vida (anti-spoofing):** uma foto de outra pessoa na tela pode ser aceita. Serve para demo/validação, não como autenticação forte.
- **Calibre o limiar com pessoas reais.** Menor = mais rígido (menos falso aceite, mais falso rejeite). Os testes automatizados usaram uma câmera simulada com imagem fixa, então não medem a taxa de erro real.
- **Bucket da Blip:** guardamos um documento por pessoa (`faceid-<id>`) e a lista é lida chamando `/buckets` + um `get` por pessoa, com cache de 30 s. Funciona bem para dezenas de pessoas; para centenas, migre o armazenamento (Table Storage/Cosmos) trocando só `src/lib/store.js`. **Valide no seu contrato** o formato da listagem de buckets e os limites de tamanho/quantidade de documentos, porque isso foi implementado pela documentação e testado só contra um simulador.
- Dois cadastros simultâneos do mesmo rosto podem passar pela checagem de duplicidade (sem lock).
- **LGPD:** rosto é dado biométrico sensível. Mantenha o consentimento (já registrado em `consentAt`), defina retenção e quem acessa a base, e tenha um caminho para exclusão a pedido do titular.
