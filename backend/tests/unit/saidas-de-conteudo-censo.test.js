// Path: tests/unit/saidas-de-conteudo-censo.test.js
//
// O CENSO DAS SAÍDAS DE CONTEÚDO: por onde um byte do servidor chega a um cliente.
//
// POR QUE ELE EXISTE, e a razão não é "mais cobertura". TRÊS revisões adversariais seguidas
// acharam um caminho de vazamento NOVO, cada uma depois de uma fase que se julgava completa: a
// F11 fechou o snapshot e a revisão achou as rotas de mapa e o pull incremental; a F12 fechou os
// dois e a revisão achou mais três. Perseguir caminho a caminho não converge, e a razão é que a
// poda estava chaveada no CARIMBO da mensagem (`op.entityType`) e no PONTO DE SAÍDA, nunca no
// conteúdo. A F13 troca as duas coisas: a poda passou a ser por conteúdo
// (`src/modules/catalog/resource-payload.prune.js`) e passou a morar em DOIS pontos por onde tudo
// atravessa (`middleware/prune-resource-payload.js` e `modules/collab/collab.send.js`). Este
// arquivo é a outra metade: ele enumera as saídas a partir do CÓDIGO e reprova a que ninguém
// classificou.
//
// O PONTO CEGO DO CENSO ANTERIOR, escrito aqui porque repeti-lo custaria outra fase. O censo de
// superfícies de recurso (`superficies-de-recurso-censo.test.js`) varre `router.get(` — e só. Das
// 131 declarações de rota deste servidor, 73 (56%) não são GET e portanto eram invisíveis para
// ele. Uma delas é `POST /atlas/:atlasId/maps/:mapId/duplicate`, que responde 201 com uma linha
// de `maps` inteira; foi por ali que a coluna irmã continuou saindo depois de a F12 declarar o
// assunto encerrado. Aqui a varredura cobre get/post/put/patch/delete/all, em `*.routes.js` E em
// `src/app.js` (a rota de health mora lá, e uma rota montada direto no app não estaria em
// arquivo de rota nenhum).
//
// AS QUATRO VARREDURAS, e a independência entre elas é o ponto:
//
//   1. ROTA — toda declaração `router.<verbo>(` / `app.<verbo>(`. Pega ROTA nova, de qualquer
//      método. Duas classes: `json-pela-poda` (o corpo, se houver, sai por `res.json`, logo
//      atravessa o middleware global) e `bytes-fora-do-json`, que precisa NOMEAR o módulo emissor,
//      conferido contra a varredura 2.
//   2. EMISSOR NÃO-JSON — todo `res.send/end/write/sendFile/jsonp/render/download` e todo
//      `pipe(res)`. É a varredura que dá dente à primeira: uma rota só pode se declarar fora da
//      poda se existir, de fato, um emissor de bytes no módulo que ela aponta. E ela pega a porta
//      dos fundos oposta: um emissor novo que sirva JSON por fora do `res.json`, que passaria pela
//      varredura 1 sem ser notado porque a rota dele parece uma rota qualquer.
//   3. SÍTIO DE ENVIO WS — todo `.send(` sob `src/modules/collab/`. O socket não passa por
//      middleware nenhum (ele nasce em `wss.on('connection')`, fora da pilha do Express), então a
//      cobertura dele é o embrulho por socket instalado em `onConnection`. Cada sítio declara em
//      qual socket escreve.
//   4. TIPO DE MENSAGEM WS — todo `type: '<nome>'` literal dentro de uma chamada de emissão
//      (`broadcastToRoom`/`closeRoom`/`broadcastOperations`/`.send(`). Pega o que a varredura 3
//      não pega: OITO dos 26 tipos nascem em controllers HTTP, fora do módulo `collab`, e uma
//      varredura restrita à pasta do socket não os enxergaria.
//
// O INVENTÁRIO VEM DO GIT, `--cached --others --exclude-standard`, e as duas bandeiras não são
// detalhe: `git ls-files` puro lista só o rastreado, e o arquivo que a fase corrente acabou de
// escrever é exatamente o que ninguém classificou ainda. O censo respondia verde sobre um
// inventário que não continha o trabalho novo.
//
// O QUE ESTE ARQUIVO NÃO PRENDE, e precisa estar escrito: COMPORTAMENTO. Que a definição some da
// resposta é `tests/integration/poda-por-conteudo.test.js` e `tests/ws/poda-ws-fronteira.test.js`;
// que o hillshade NÃO some é caso dos mesmos arquivos; que a poda devolve o snapshot inteiro para
// quem tem a concessão é `sync-catalog-layer-privado.test.js`. Um censo verde com aqueles ausentes
// prova só que ninguém abriu porta nova sem declarar, o que é útil e não é a mesma coisa.
//
// FRAGILIDADES ACEITAS, declaradas em voz alta em vez de escondidas:
//   (a) rota montada por FÁBRICA (`makeCatalogRouter(tabela)`, quatro montagens em `app.js`)
//       aparece UMA vez, no arquivo da fábrica. É onde a decisão mora, então é onde a
//       classificação pertence.
//   (b) caminho de rota construído em variável não casa. A direção do erro é PERDER um sítio, e é
//       por isso que existe o caso-piso com as contagens medidas: uma varredura que deixasse de
//       casar passaria todos os outros casos comparando vazio com vazio.
//   (c) a remoção de comentário é textual, não é parser: `//` dentro de literal cai junto.
//   (d) tipo de mensagem cujo `type` venha de variável não casa. Nenhum hoje; o piso cobra 26.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

// --- classes da varredura 1 (rota) ---------------------------------------------------
const R_JSON = 'json-pela-poda';
const R_BYTES = 'bytes-fora-do-json';

// --- classes da varredura 2 (emissor não-json) ----------------------------------------
const E_BYTES = 'bytes-de-arquivo';
const E_SEM_CORPO = 'sem-corpo';

// --- classes da varredura 3 (sítio de envio WS) ---------------------------------------
const W_EMBRULHADO = 'socket-embrulhado-em-onConnection';

// --- classes da varredura 4 (tipo de mensagem WS) -------------------------------------
const M_ENTIDADE = 'carrega-entidade';
const M_SEM_ENTIDADE = 'sem-carga-de-entidade';

const json = (arquivo, rota) => ({ arquivo, rota, classe: R_JSON });
const bytes = (arquivo, rota, emissor) => ({ arquivo, rota, classe: R_BYTES, emissor });

/**
 * O CENSO DAS ROTAS. Uma linha por declaração, de qualquer método.
 *
 * `json-pela-poda` não é um voto de confiança e sim uma consequência: o corpo sai por `res.json`,
 * que `app.js` embrulha ANTES de montar qualquer rota, então a poda por conteúdo é atravessada
 * quer o autor da rota saiba disso ou não. Rota sem corpo (204/304) cai na mesma classe pelo
 * motivo mais forte de todos: não há corpo.
 *
 * DUAS ROTAS QUE MERECEM NOTA, e a nota é o que um censo entrega além da contagem:
 *   - `POST /atlas/:atlasId/maps/:mapId/duplicate` devolve a linha de `maps` nova. É a saída que o
 *     censo anterior não enxergava por varrer só `router.get(`.
 *   - `POST /atlas/:atlasId/clone` é gateada em `read` e devolve só metadado — mas COPIA o
 *     conteúdo do atlas para um atlas do chamador. RISCO declarado: é vazamento por CÓPIA, não por
 *     resposta, e portanto fora do alcance de qualquer poda de saída; quem o fecha é o gate da
 *     rota, não este censo.
 */
const CENSO_ROTA = [
  json('src/app.js', 'GET /api/v1/health'),

  json('src/modules/atlas/atlas.routes.js', 'GET /'),
  json('src/modules/atlas/atlas.routes.js', 'POST /'),
  json('src/modules/atlas/atlas.routes.js', 'POST /import'),
  json('src/modules/atlas/atlas.routes.js', 'GET /public/:link'),
  json('src/modules/atlas/atlas.routes.js', 'GET /trash'),
  json('src/modules/atlas/atlas.routes.js', 'GET /overview'),
  json('src/modules/atlas/atlas.routes.js', 'GET /presence'),
  json('src/modules/atlas/atlas.routes.js', 'GET /:atlasId'),
  json('src/modules/atlas/atlas.routes.js', 'PUT /:atlasId'),
  json('src/modules/atlas/atlas.routes.js', 'DELETE /:atlasId'),
  json('src/modules/atlas/atlas.routes.js', 'POST /:atlasId/restore'),
  json('src/modules/atlas/atlas.routes.js', 'GET /:atlasId/settings'),
  json('src/modules/atlas/atlas.routes.js', 'PATCH /:atlasId/settings'),
  json('src/modules/atlas/atlas.routes.js', 'POST /:atlasId/transfer'),
  json('src/modules/atlas/atlas.routes.js', 'PUT /:atlasId/cover'),
  json('src/modules/atlas/atlas.routes.js', 'DELETE /:atlasId/cover'),
  json('src/modules/atlas/atlas.routes.js', 'GET /:atlasId/resources'),
  json('src/modules/atlas/atlas.routes.js', 'POST /:atlasId/resources'),
  json('src/modules/atlas/atlas.routes.js', 'DELETE /:atlasId/resources/:type/:id'),
  json('src/modules/atlas/atlas.routes.js', 'POST /:atlasId/clone'),
  json('src/modules/atlas/atlas.routes.js', 'POST /:atlasId/maps/:mapId/duplicate'),

  json('src/modules/audit/audit.routes.js', 'GET /'),

  json('src/modules/auth/auth.routes.js', 'POST /register'),
  json('src/modules/auth/auth.routes.js', 'POST /verify-email'),
  json('src/modules/auth/auth.routes.js', 'POST /resend-verification'),
  json('src/modules/auth/auth.routes.js', 'POST /login'),
  json('src/modules/auth/auth.routes.js', 'POST /refresh'),
  json('src/modules/auth/auth.routes.js', 'POST /logout'),
  json('src/modules/auth/auth.routes.js', 'GET /me'),

  json('src/modules/briefings/briefings.routes.js', 'GET /'),
  json('src/modules/briefings/briefings.routes.js', 'GET /:briefingId'),

  json('src/modules/catalog/catalog.routes.js', 'GET /'),
  json('src/modules/catalog/catalog.routes.js', 'GET /:id'),
  json('src/modules/catalog/catalog.routes.js', 'POST /'),
  json('src/modules/catalog/catalog.routes.js', 'PUT /:id'),
  json('src/modules/catalog/catalog.routes.js', 'DELETE /:id'),

  json('src/modules/config/config.routes.js', 'GET /'),
  json('src/modules/config/config.routes.js', 'GET /admin'),
  json('src/modules/config/config.routes.js', 'PUT /admin'),
  json('src/modules/config/config.routes.js', 'DELETE /admin'),

  json('src/modules/debug/debug.routes.js', 'GET /trace'),
  json('src/modules/debug/debug.routes.js', 'DELETE /trace'),

  json('src/modules/images/images.routes.js', 'GET /'),
  json('src/modules/images/images.routes.js', 'POST /'),
  json('src/modules/images/images.routes.js', 'POST /bulk'),
  bytes('src/modules/images/images.routes.js', 'GET /:imageId', 'src/modules/images/images.controller.js'),
  json('src/modules/images/images.routes.js', 'DELETE /:imageId'),

  json('src/modules/maps/maps.routes.js', 'GET /'),
  json('src/modules/maps/maps.routes.js', 'GET /:mapId'),
  json('src/modules/maps/maps.routes.js', 'POST /:mapId/merge'),

  bytes('src/modules/nomes/assets3d.routes.js', 'GET /*', 'src/modules/nomes/assets3d.controller.js'),

  json('src/modules/nomes/nomes.routes.js', 'GET /busca'),
  json('src/modules/nomes/nomes.routes.js', 'GET /feicoes'),

  json('src/modules/organizations/organizations.routes.js', 'GET /'),
  json('src/modules/organizations/organizations.routes.js', 'GET /:id'),
  json('src/modules/organizations/organizations.routes.js', 'POST /'),
  json('src/modules/organizations/organizations.routes.js', 'PUT /:id'),
  json('src/modules/organizations/organizations.routes.js', 'DELETE /:id'),

  json('src/modules/ranks/ranks.routes.js', 'GET /'),
  json('src/modules/ranks/ranks.routes.js', 'GET /:id'),
  json('src/modules/ranks/ranks.routes.js', 'POST /'),
  json('src/modules/ranks/ranks.routes.js', 'PUT /:id'),
  json('src/modules/ranks/ranks.routes.js', 'DELETE /:id'),

  json('src/modules/resource-access/resource-access.routes.js', 'GET /visible'),
  json('src/modules/resource-access/resource-access.routes.js', 'PATCH /:type/:id/visibility'),
  json('src/modules/resource-access/resource-access.routes.js', 'GET /:type/:id/grants'),
  json('src/modules/resource-access/resource-access.routes.js', 'POST /:type/:id/grants'),
  json('src/modules/resource-access/resource-access.routes.js', 'DELETE /grants/:grantId'),

  json('src/modules/sharing/sharing.routes.js', 'GET /'),
  json('src/modules/sharing/sharing.routes.js', 'POST /public'),
  json('src/modules/sharing/sharing.routes.js', 'DELETE /public'),
  json('src/modules/sharing/sharing.routes.js', 'POST /users'),
  json('src/modules/sharing/sharing.routes.js', 'PUT /users/:userId'),
  json('src/modules/sharing/sharing.routes.js', 'DELETE /users/:userId'),

  json('src/modules/streetview360/sv360.routes.js', 'GET /tiles/fotos.geojson'),
  bytes('src/modules/streetview360/sv360.routes.js', 'GET /tiles/:z/:x/:y.pbf', 'src/modules/streetview360/sv360.controller.js'),
  bytes('src/modules/streetview360/sv360.routes.js', 'GET /thumbnails/:slug.webp', 'src/modules/streetview360/sv360.controller.js'),
  json('src/modules/streetview360/sv360.routes.js', 'GET /projects'),
  json('src/modules/streetview360/sv360.routes.js', 'GET /projects/review-stats'),
  json('src/modules/streetview360/sv360.routes.js', 'GET /projects/:slug'),
  json('src/modules/streetview360/sv360.routes.js', 'GET /projects/:slug/floors'),
  json('src/modules/streetview360/sv360.routes.js', 'GET /projects/:slug/photos'),
  json('src/modules/streetview360/sv360.routes.js', 'GET /projects/:slug/map'),
  json('src/modules/streetview360/sv360.routes.js', 'GET /projects/:slug/runs'),
  json('src/modules/streetview360/sv360.routes.js', 'GET /photos/nearest'),
  json('src/modules/streetview360/sv360.routes.js', 'GET /photos/by-name/:nome'),
  json('src/modules/streetview360/sv360.routes.js', 'GET /photos/:uuid'),
  json('src/modules/streetview360/sv360.routes.js', 'GET /photos/:uuid/nearby'),
  bytes('src/modules/streetview360/sv360.routes.js', 'GET /photos/:uuid/image', 'src/modules/streetview360/sv360.controller.js'),
  json('src/modules/streetview360/sv360.routes.js', 'POST /photos/batch-calibration'),
  json('src/modules/streetview360/sv360.routes.js', 'PUT /photos/:uuid/calibration'),
  json('src/modules/streetview360/sv360.routes.js', 'PUT /photos/:uuid/rotation-x'),
  json('src/modules/streetview360/sv360.routes.js', 'PUT /photos/:uuid/rotation-z'),
  json('src/modules/streetview360/sv360.routes.js', 'PUT /photos/:uuid/reviewed'),
  json('src/modules/streetview360/sv360.routes.js', 'PUT /photos/:uuid/targets/:targetId/visibility'),
  json('src/modules/streetview360/sv360.routes.js', 'DELETE /photos/:uuid/targets/:targetId'),
  json('src/modules/streetview360/sv360.routes.js', 'POST /photos/:uuid/targets'),
  json('src/modules/streetview360/sv360.routes.js', 'DELETE /photos/:uuid'),
  json('src/modules/streetview360/sv360.routes.js', 'PUT /projects/:slug/batch-calibration'),
  json('src/modules/streetview360/sv360.routes.js', 'POST /projects/:slug/reset-reviewed'),
  json('src/modules/streetview360/sv360.routes.js', 'PUT /runs/:runId/batch-calibration'),
  json('src/modules/streetview360/sv360.routes.js', 'POST /admin/projects/upload'),
  json('src/modules/streetview360/sv360.routes.js', 'GET /admin/projects'),
  json('src/modules/streetview360/sv360.routes.js', 'PATCH /admin/projects/:slug/status'),
  json('src/modules/streetview360/sv360.routes.js', 'DELETE /admin/projects/:slug'),

  json('src/modules/sync/sync.routes.js', 'GET /admin/stats'),
  json('src/modules/sync/sync.routes.js', 'POST /admin/cleanup'),
  json('src/modules/sync/sync.routes.js', 'POST /'),
  json('src/modules/sync/sync.routes.js', 'GET /:version'),

  json('src/modules/users/users.routes.js', 'GET /me'),
  json('src/modules/users/users.routes.js', 'PUT /me'),
  json('src/modules/users/users.routes.js', 'PUT /me/password'),
  json('src/modules/users/users.routes.js', 'POST /me/api-key/rotate'),
  json('src/modules/users/users.routes.js', 'GET /search'),
  json('src/modules/users/users.routes.js', 'GET /'),
  json('src/modules/users/users.routes.js', 'POST /'),
  json('src/modules/users/users.routes.js', 'GET /:userId'),
  json('src/modules/users/users.routes.js', 'PUT /:userId'),
  json('src/modules/users/users.routes.js', 'POST /:userId/reset-password'),
  json('src/modules/users/users.routes.js', 'DELETE /:userId'),
  json('src/modules/users/users.routes.js', 'POST /:userId/reactivate'),
  json('src/modules/users/users.routes.js', 'POST /:userId/api-key/rotate'),

  json('src/modules/zones/zones.routes.js', 'GET /'),
  json('src/modules/zones/zones.routes.js', 'POST /'),
  json('src/modules/zones/zones.routes.js', 'GET /:id'),
  json('src/modules/zones/zones.routes.js', 'PUT /:id'),
  json('src/modules/zones/zones.routes.js', 'DELETE /:id'),
  json('src/modules/zones/zones.routes.js', 'GET /:id/permissions'),
  json('src/modules/zones/zones.routes.js', 'PUT /:id/permissions'),
];

const BYTES_DE_ARQUIVO = 'Bytes de arquivo (imagem, tile MVT, asset 3D, foto 360), com Content-Type '
  + 'binário. Não é documento de entidade e não tem como carregar definição de camada de catálogo: '
  + 'o conteúdo vem de arquivo no disco ou de BLOB, nunca de payload de cliente com forma de '
  + 'entrada de catálogo. O recorte de ACESSO destes caminhos é outro assunto, com outro guarda '
  + '(`superficies-de-recurso-censo.test.js`).';

const SEM_CORPO = 'Resposta sem corpo (204, 304 ou 416). Não há JSON para podar; o método é '
  + '`end()`/`send()` justamente porque nada é serializado.';

/**
 * O CENSO DOS EMISSORES QUE NÃO SÃO `res.json`.
 *
 * São as únicas saídas HTTP que o embrulho global não alcança, e é por isso que cada uma precisa
 * de motivo: `res.json` é embrulhado, `res.end(buffer)` não. Duas classes, e a diferença entre
 * elas é o que carrega:
 *   - `bytes-de-arquivo`: imagem, tile MVT, asset 3D, foto 360. Nenhum é documento de entidade e
 *     nenhum pode carregar definição de camada de catálogo — são bytes de arquivo no disco, com
 *     Content-Type binário. O recorte de ACESSO deles é outro assunto e tem outro guarda
 *     (`superficies-de-recurso-censo.test.js`, varreduras 3 e 4).
 *   - `sem-corpo`: 204, 304 e 416. Não há corpo para podar.
 */
const CENSO_EMISSOR = [
  { arquivo: 'src/modules/atlas/atlas.controller.js', texto: 'res.status(204).send();', n: 2,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },

  { arquivo: 'src/modules/auth/auth.controller.js', texto: 'res.status(204).send();', n: 1,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },

  { arquivo: 'src/modules/catalog/catalog.controller.js', texto: 'res.status(204).send();', n: 1,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },

  { arquivo: 'src/modules/images/images.controller.js', texto: 'res.sendFile(path, {', n: 1,
    classe: E_BYTES, motivo: BYTES_DE_ARQUIVO },
  { arquivo: 'src/modules/images/images.controller.js', texto: 'res.status(204).send();', n: 1,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },

  { arquivo: 'src/modules/nomes/assets3d.controller.js', texto: 'if (req.headers[\'if-none-match\'] === meta.etag) return res.status(304).end();', n: 1,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },
  { arquivo: 'src/modules/nomes/assets3d.controller.js', texto: 'return res.status(416).setHeader(\'Content-Range\', `bytes */${meta.size_bytes}`).end();', n: 1,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },
  { arquivo: 'src/modules/nomes/assets3d.controller.js', texto: 'return res.end(buf.subarray(range.start, range.end + 1));', n: 1,
    classe: E_BYTES, motivo: BYTES_DE_ARQUIVO },
  { arquivo: 'src/modules/nomes/assets3d.controller.js', texto: 'return res.end(buf);', n: 1,
    classe: E_BYTES, motivo: BYTES_DE_ARQUIVO },
  { arquivo: 'src/modules/nomes/assets3d.controller.js', texto: 'if (req.headers[\'if-none-match\'] === fmeta.etag) return res.status(304).end();', n: 1,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },
  { arquivo: 'src/modules/nomes/assets3d.controller.js', texto: 'return res.status(416).setHeader(\'Content-Range\', `bytes */${fmeta.size}`).end();', n: 1,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },

  { arquivo: 'src/modules/organizations/organizations.controller.js', texto: 'res.status(204).send();', n: 1,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },

  { arquivo: 'src/modules/ranks/ranks.controller.js', texto: 'res.status(204).send();', n: 1,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },

  { arquivo: 'src/modules/sharing/sharing.controller.js', texto: 'res.status(204).send();', n: 2,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },

  { arquivo: 'src/modules/streetview360/sv360.admin.controller.js', texto: 'res.status(204).end();', n: 1,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },

  { arquivo: 'src/modules/streetview360/sv360.controller.js', texto: 'if (req.headers[\'if-none-match\'] === etag) return res.status(304).end();', n: 2,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },
  { arquivo: 'src/modules/streetview360/sv360.controller.js', texto: 'return res.status(200).end(tile);', n: 1,
    classe: E_BYTES, motivo: BYTES_DE_ARQUIVO },
  { arquivo: 'src/modules/streetview360/sv360.controller.js', texto: 'return res.status(416).setHeader(\'Content-Range\', `bytes */${st.size}`).end();', n: 1,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },
  { arquivo: 'src/modules/streetview360/sv360.controller.js', texto: 'if (req.headers[\'if-none-match\'] === d.etag) return res.status(304).end();', n: 1,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },
  { arquivo: 'src/modules/streetview360/sv360.controller.js', texto: 'return res.status(416).setHeader(\'Content-Range\', `bytes */${size}`).end();', n: 1,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },
  { arquivo: 'src/modules/streetview360/sv360.controller.js', texto: 'return res.end(buf.subarray(range.start, range.end + 1));', n: 1,
    classe: E_BYTES, motivo: BYTES_DE_ARQUIVO },
  { arquivo: 'src/modules/streetview360/sv360.controller.js', texto: 'return res.end(buf);', n: 1,
    classe: E_BYTES, motivo: BYTES_DE_ARQUIVO },

  { arquivo: 'src/modules/streetview360/sv360.write.controller.js', texto: 'res.status(204).end();', n: 2,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },

  { arquivo: 'src/modules/zones/zones.controller.js', texto: 'res.status(204).send();', n: 1,
    classe: E_SEM_CORPO, motivo: SEM_CORPO },

  { arquivo: 'src/utils/stream-file.js', texto: 'rs.pipe(res);', n: 1,
    classe: E_BYTES, motivo: BYTES_DE_ARQUIVO },
];

const SOCKET_DA_SALA = 'Socket de cliente de colaboração. Todo socket desta sala entrou por '
  + '`onConnection` (`collab.gateway.js`), cuja PRIMEIRA linha instala '
  + '`installOutboundResourcePrune`, então este `send` é o embrulhado, e não o original.';

/**
 * O CENSO DOS SÍTIOS DE ENVIO WS.
 *
 * A garantia aqui não é sítio a sítio, é por construção: o embrulho substitui `ws.send` no próprio
 * objeto do socket, então quem chamar `ws.send`/`client.send` chama o embrulho, tenha ou não ouvido
 * falar dele. Foi essa propriedade que faltava até a F13, e o preço foi o quarto relay
 * (`handleOperation`, um frame `operation` SINGULAR) espalhar a carga do autor verbatim enquanto
 * o cabeçalho de `catalog-layer-op.js` afirmava que um quarto relay estaria "coberto por
 * construção".
 *
 * O que o censo cobra, então, é a PROVENIÊNCIA do socket: um `send` novo escrevendo num objeto que
 * não veio de `onConnection` seria o buraco, e ele reprova aqui até alguém dizer de onde veio.
 */
const CENSO_ENVIO_WS = [
  { arquivo: 'src/modules/collab/collab.gateway.js', texto: 'ws.send(JSON.stringify({', n: 1, classe: W_EMBRULHADO, motivo: SOCKET_DA_SALA },

  { arquivo: 'src/modules/collab/collab.handlers.js', texto: 'ws.send(JSON.stringify({', n: 10, classe: W_EMBRULHADO, motivo: SOCKET_DA_SALA },
  { arquivo: 'src/modules/collab/collab.handlers.js', texto: 'ws.send(JSON.stringify({ type: \'pong\' }));', n: 1, classe: W_EMBRULHADO, motivo: SOCKET_DA_SALA },
  { arquivo: 'src/modules/collab/collab.handlers.js', texto: 'ws.send({', n: 2, classe: W_EMBRULHADO, motivo: SOCKET_DA_SALA },

  { arquivo: 'src/modules/collab/collab.rooms.js', texto: 'client.send(payload);', n: 2, classe: W_EMBRULHADO, motivo: SOCKET_DA_SALA },
  { arquivo: 'src/modules/collab/collab.rooms.js', texto: 'client.send(fullPayload);', n: 1, classe: W_EMBRULHADO, motivo: SOCKET_DA_SALA },
  { arquivo: 'src/modules/collab/collab.rooms.js', texto: 'client.send(readPayload);', n: 1, classe: W_EMBRULHADO, motivo: SOCKET_DA_SALA },
];

const RELAY = "Relay de operação de sync: carrega documento de entidade escrito por um cliente e reenviado à sala inteira, visitante anônimo de link público incluído. Atravessa o embrulho de `ws.send`, e o lote é podado como OBJETO antes do fan-out para não pagar a varredura por destinatário.";
const SNAPSHOT = "Resposta de `sync_request`: snapshot inteiro do atlas ou trecho do log. É o único frame que carrega definição AUTORIZADA, por isso é entregue ao `send` como OBJETO — a autorização é por identidade e não sobrevive a um `JSON.stringify` feito antes da fronteira.";
const PRESENCA = "Frame de presença/consciência: identidade, cursor, seleção, janela temporal, entrada e saída de par. Não carrega documento de entidade.";
const CONTROLE = "Frame de controle do protocolo (handshake, keepalive, ack, erro, ajuste adaptativo). Carrega id, versão e texto de erro, nunca payload de entidade.";
const AVISO = "Aviso de mudança no ATLAS emitido por rota HTTP: o cliente reage buscando o dado novo. Carrega id, e no caso de `atlas_updated` a linha de `atlas` (schema fechado, sem coluna livre) e as `settings` (schema declarado, `stripUnknown`). Nenhum carrega documento de mapa.";

/**
 * O CENSO DOS TIPOS DE MENSAGEM WS.
 *
 * `carrega-entidade` são os frames que transportam documento de atlas; todos passam pelo embrulho
 * de `ws.send`, e o `sync_response` é o único que também carrega definição AUTORIZADA (por isso é
 * entregue ao `send` como OBJETO, não como string: a autorização é por identidade e não sobrevive
 * a `JSON.stringify` feito antes da fronteira).
 */
const CENSO_TIPO_WS = [
  { tipo: 'connected', classe: M_SEM_ENTIDADE, motivo: PRESENCA },
  { tipo: 'pong', classe: M_SEM_ENTIDADE, motivo: CONTROLE },
  { tipo: 'error', classe: M_SEM_ENTIDADE, motivo: CONTROLE },
  { tipo: 'ack', classe: M_SEM_ENTIDADE, motivo: CONTROLE },
  { tipo: 'ack_batch', classe: M_SEM_ENTIDADE, motivo: CONTROLE },
  { tipo: 'adaptive-settings', classe: M_SEM_ENTIDADE, motivo: CONTROLE },
  { tipo: 'cursor', classe: M_SEM_ENTIDADE, motivo: PRESENCA },
  { tipo: 'selection', classe: M_SEM_ENTIDADE, motivo: PRESENCA },
  { tipo: 'temporal', classe: M_SEM_ENTIDADE, motivo: PRESENCA },
  { tipo: 'user_joined', classe: M_SEM_ENTIDADE, motivo: PRESENCA },
  { tipo: 'user_left', classe: M_SEM_ENTIDADE, motivo: PRESENCA },
  { tipo: 'user_away', classe: M_SEM_ENTIDADE, motivo: PRESENCA },
  { tipo: 'user_back', classe: M_SEM_ENTIDADE, motivo: PRESENCA },
  { tipo: 'briefing_edit_started', classe: M_SEM_ENTIDADE, motivo: PRESENCA },
  { tipo: 'briefing_edit_ended', classe: M_SEM_ENTIDADE, motivo: PRESENCA },
  { tipo: 'operations', classe: M_ENTIDADE, motivo: RELAY },
  { tipo: 'operation', classe: M_ENTIDADE, motivo: RELAY },
  { tipo: 'sync_response', classe: M_ENTIDADE, motivo: SNAPSHOT },
  { tipo: 'atlas_updated', classe: M_SEM_ENTIDADE, motivo: AVISO },
  { tipo: 'atlas_settings_updated', classe: M_SEM_ENTIDADE, motivo: AVISO },
  { tipo: 'atlas_deleted', classe: M_SEM_ENTIDADE, motivo: AVISO },
  { tipo: 'atlas_owner_changed', classe: M_SEM_ENTIDADE, motivo: AVISO },
  { tipo: 'atlas_resources_updated', classe: M_SEM_ENTIDADE, motivo: AVISO },
  { tipo: 'map_duplicated', classe: M_SEM_ENTIDADE, motivo: AVISO },
  { tipo: 'maps_merged', classe: M_SEM_ENTIDADE, motivo: AVISO },
  { tipo: 'sharing_updated', classe: M_SEM_ENTIDADE, motivo: AVISO },
];

// =============================================================================
// AS VARREDURAS
// =============================================================================

/** Comentário fora, para que texto em comentário não vire achado. */
function semComentarios(src) {
  const normalizado = src.replace(/\r\n?/g, '\n');
  const semBloco = normalizado.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return semBloco.split('\n').map((linha) => linha.replace(/\/\/.*/, '')).join('\n');
}

/**
 * O INVENTÁRIO: rastreado MAIS não rastreado não ignorado. Ver o cabeçalho.
 * @param {string} [pathspec]
 * @returns {string[]}
 */
function arquivosDoInventario(pathspec = 'src') {
  return execFileSync(
    'git', ['ls-files', '--cached', '--others', '--exclude-standard', pathspec],
    { cwd: RAIZ, encoding: 'utf8' }
  ).split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.js'));
}

const lerCodigo = (arquivo) => semComentarios(fs.readFileSync(path.join(RAIZ, arquivo), 'utf8'));

/** Os arquivos onde uma rota pode ser declarada: os de rota E o próprio app. */
const arquivosDeRota = (inventario) => inventario
  .filter((a) => a.endsWith('.routes.js') || a === 'src/app.js');

const RE_ROTA = /\b(?:router|app)\.(get|post|put|patch|delete|all)\(\s*(['"`])([^'"`]*)\2/g;

/**
 * VARREDURA 1 — toda declaração de rota, de qualquer método.
 * @param {string[]} arquivos
 * @returns {{arquivo: string, rota: string, linha: number}[]}
 */
function rotasDeSaida(arquivos) {
  const achadas = [];
  for (const arquivo of arquivos) {
    const src = lerCodigo(arquivo);
    const re = new RegExp(RE_ROTA.source, 'g');
    let m = re.exec(src);
    while (m !== null) {
      achadas.push({
        arquivo,
        rota: `${m[1].toUpperCase()} ${m[3]}`,
        linha: src.slice(0, m.index).split('\n').length,
      });
      m = re.exec(src);
    }
  }
  return achadas;
}

/** As rotas sem entrada no censo, no formato de mensagem de erro. */
function rotasNaoClassificadas(achadas) {
  return achadas
    .filter((a) => !CENSO_ROTA.some((e) => e.arquivo === a.arquivo && e.rota === a.rota))
    .map((a) => `${a.arquivo}:${a.linha} ${a.rota}`);
}

/**
 * Emissor que NÃO é `res.json`. Larga o bastante para pegar o encadeamento
 * (`res.status(200).end(tile)`), que é a forma que a primeira versão desta varredura perdeu.
 */
const RE_EMISSOR =
  /\bres\s*(?:\.\s*[A-Za-z_$][\w$]*\s*\([^;]*?\))*\s*\.\s*(send|end|write|sendFile|jsonp|render|download)\s*\(|\.\s*pipe\s*\(\s*res\b/;

/**
 * A CHAVE É (arquivo, TEXTO DA LINHA) E A CONTAGEM, não o número da linha.
 *
 * Número de linha muda quando alguém acrescenta um comentário trinta linhas acima, e um censo que
 * fica vermelho por isso é um censo que alguém afrouxa. Texto mais contagem prende o que importa:
 * um emissor NOVO não casa nenhuma entrada, e um segundo `res.end(buf)` no mesmo arquivo faz a
 * contagem divergir.
 * @param {Map<string, number>} achados
 * @param {{arquivo: string, texto: string, n: number}[]} censo
 * @returns {string[]}
 */
function naoClassificados(achados, censo) {
  const problemas = [];
  for (const [chave, n] of achados) {
    const [arquivo, texto] = chave.split(' :: ');
    const entrada = censo.find((e) => e.arquivo === arquivo && e.texto === texto);
    if (!entrada) problemas.push(`${arquivo} :: ${texto.slice(0, 90)}`);
    else if (entrada.n !== n) problemas.push(`${arquivo} :: ${texto.slice(0, 60)} (censo diz ${entrada.n}, achei ${n})`);
  }
  // E a direção inversa: entrada de censo que não casa nada é cobertura vazia, o defeito mais
  // repetido do livro-razão. Uma linha removida do código precisa sair do censo junto.
  for (const e of censo) {
    if (!achados.has(`${e.arquivo} :: ${e.texto}`)) problemas.push(`${e.arquivo} :: entrada de censo sem sítio: ${e.texto.slice(0, 60)}`);
  }
  return problemas;
}

/**
 * VARREDURA 2 — todo emissor de resposta que não passa por `res.json`.
 * @param {string[]} arquivos
 * @returns {Map<string, number>} `arquivo :: texto` -> ocorrências.
 */
function emissoresNaoJson(arquivos) {
  const achados = new Map();
  for (const arquivo of arquivos) {
    for (const linha of lerCodigo(arquivo).split('\n')) {
      if (!RE_EMISSOR.test(linha)) continue;
      const chave = `${arquivo} :: ${linha.trim()}`;
      achados.set(chave, (achados.get(chave) || 0) + 1);
    }
  }
  return achados;
}

/** Os arquivos do módulo de colaboração, que é onde o socket é escrito. */
const arquivosDeCollab = (inventario) => inventario
  .filter((a) => a.startsWith('src/modules/collab/'));

/**
 * VARREDURA 3 — todo sítio que escreve num socket.
 * @param {string[]} arquivos
 * @returns {Map<string, number>} `arquivo :: texto` -> ocorrências.
 */
function sitiosDeEnvioWs(arquivos) {
  const achados = new Map();
  for (const arquivo of arquivos) {
    for (const linha of lerCodigo(arquivo).split('\n')) {
      if (!/\.send\(/.test(linha)) continue;
      const chave = `${arquivo} :: ${linha.trim()}`;
      achados.set(chave, (achados.get(chave) || 0) + 1);
    }
  }
  return achados;
}

/** Soma das ocorrências de um mapa de achados, que é a contagem de SÍTIOS. */
const totalDe = (achados) => [...achados.values()].reduce((a, b) => a + b, 0);

/** Chamada de emissão: as três do módulo de salas, mais qualquer `.send(`. */
const RE_EMISSAO_WS = /\b(?:broadcastToRoom|broadcastOperations|closeRoom)\s*\(|\.send\s*\(/g;
const RE_TIPO = /type:\s*(['"`])([\w-]+)\1/;

/**
 * VARREDURA 4 — todo tipo de mensagem WS literal, onde quer que a emissão seja escrita.
 *
 * A janela de 400 caracteres a partir da chamada é o que casa tanto a forma de uma linha
 * (`broadcastToRoom(id, { type: 'x' })`) quanto a de várias, sem precisar de um parser. Uma chamada
 * sem `type` literal (`broadcastOperations(...)`, `client.send(payload)`) não produz achado: o tipo
 * dela é escrito onde a mensagem é montada, e ali ele casa.
 *
 * @param {string[]} arquivos
 * @returns {Map<string, string[]>} tipo -> sítios.
 */
function tiposDeMensagemWs(arquivos) {
  const porTipo = new Map();
  for (const arquivo of arquivos) {
    const src = lerCodigo(arquivo);
    const re = new RegExp(RE_EMISSAO_WS.source, 'g');
    let m = re.exec(src);
    while (m !== null) {
      const janela = src.slice(m.index, m.index + 400);
      const t = RE_TIPO.exec(janela);
      if (t) {
        const linha = src.slice(0, m.index).split('\n').length;
        if (!porTipo.has(t[2])) porTipo.set(t[2], []);
        porTipo.get(t[2]).push(`${arquivo}:${linha}`);
      }
      m = re.exec(src);
    }
  }
  return porTipo;
}

/** Os tipos de mensagem sem entrada no censo. */
function tiposNaoClassificados(porTipo) {
  return [...porTipo.keys()]
    .filter((t) => !CENSO_TIPO_WS.some((e) => e.tipo === t))
    .sort();
}

// =============================================================================
// OS CASOS
// =============================================================================

describe('Censo das saídas de conteúdo (fase F13)', () => {
  const inventario = arquivosDoInventario();

  it('piso: o inventário vem do git e as quatro varreduras acham o que já existe', () => {
    assert.ok(
      inventario.length > 100,
      `o inventário precisa vir do git e alcançar o servidor inteiro; vieram ${inventario.length} arquivos`
    );

    // AS CONTAGENS MEDIDAS. Sem elas, uma varredura que deixasse de casar (uma regex quebrada, um
    // pathspec errado) passaria TODOS os casos abaixo comparando conjunto vazio com conjunto
    // vazio — que é a forma mais barata de um censo virar decoração.
    // O PISO CAIU DE 131 PARA 130 NA F15, e a queda é o registro de uma rota que saiu:
    // `GET /nomes/catalogo3d`, do segundo catálogo de modelo 3D. Piso decrescente só se
    // mexe junto com a remoção que o causou, e com o nome dela escrito.
    const rotas = rotasDeSaida(arquivosDeRota(inventario));
    assert.ok(rotas.length >= 130, `esperava >= 130 declarações de rota, achei ${rotas.length}`);
    const porMetodo = new Set(rotas.map((r) => r.rota.split(' ')[0]));
    for (const metodo of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.ok(porMetodo.has(metodo), `a varredura precisa enxergar ${metodo}; o censo anterior só via GET`);
    }
    assert.ok(
      rotas.some((r) => r.rota === 'POST /:atlasId/maps/:mapId/duplicate'),
      'a rota de duplicação precisa aparecer: foi ela que o censo anterior perdeu por varrer só `router.get(`'
    );

    assert.ok(totalDe(emissoresNaoJson(inventario)) >= 29, 'a varredura de emissor precisa achar os 29 sítios medidos');
    assert.ok(totalDe(sitiosDeEnvioWs(arquivosDeCollab(inventario))) >= 18, 'a varredura de envio WS precisa achar os 18 sítios medidos');
    assert.ok(tiposDeMensagemWs(inventario).size >= 26, 'a varredura de tipo WS precisa achar os tipos existentes');
  });

  it('toda ROTA está no censo, de qualquer método', () => {
    const acusadas = rotasNaoClassificadas(rotasDeSaida(arquivosDeRota(inventario)));
    assert.deepEqual(
      acusadas, [],
      'rota nova sem classificação. Diga se o corpo dela sai por `res.json` (e portanto pela poda '
      + `de conteúdo) ou por bytes fora dela:\n${acusadas.join('\n')}`
    );
  });

  it('toda entrada de rota tem classe válida, e a de BYTES nomeia um emissor que existe', () => {
    const emissores = new Set([...emissoresNaoJson(inventario).keys()].map((k) => k.slice(0, k.indexOf(' '))));
    const ruins = [];
    for (const e of CENSO_ROTA) {
      if (![R_JSON, R_BYTES].includes(e.classe)) ruins.push(`${e.arquivo} ${e.rota}: classe inválida`);
      if (e.classe !== R_BYTES) continue;
      // A DIREÇÃO PERIGOSA é esta: declarar "bytes" para uma rota que na verdade serve JSON
      // isentaria a rota da poda com uma frase. Por isso o módulo apontado precisa CONTER um
      // emissor de bytes de verdade, medido pela varredura 2.
      if (!e.emissor) ruins.push(`${e.arquivo} ${e.rota}: classe bytes sem emissor nomeado`);
      else if (!emissores.has(e.emissor)) {
        ruins.push(`${e.arquivo} ${e.rota}: emissor ${e.emissor} não tem saída não-json nenhuma`);
      }
    }
    assert.deepEqual(ruins, []);
  });

  it('todo EMISSOR não-json está no censo, com classe e motivo', () => {
    const acusados = naoClassificados(emissoresNaoJson(inventario), CENSO_EMISSOR);
    assert.deepEqual(
      acusados, [],
      `saída HTTP que não passa por \`res.json\` e ninguém classificou:\n${acusados.join('\n')}`
    );

    const ruins = CENSO_EMISSOR
      .filter((e) => ![E_BYTES, E_SEM_CORPO].includes(e.classe) || !e.motivo)
      .map((e) => `${e.arquivo} :: ${e.texto}`);
    assert.deepEqual(ruins, [], 'entrada de emissor sem classe válida ou sem motivo escrito');
  });

  it('todo SÍTIO DE ENVIO WS está no censo', () => {
    const acusados = naoClassificados(sitiosDeEnvioWs(arquivosDeCollab(inventario)), CENSO_ENVIO_WS);
    assert.deepEqual(
      acusados, [],
      `escrita nova num socket. Diga em qual socket ela escreve:\n${acusados.join('\n')}`
    );
    const ruins = CENSO_ENVIO_WS.filter((e) => e.classe !== W_EMBRULHADO || !e.motivo);
    assert.deepEqual(ruins.map((e) => `${e.arquivo} :: ${e.texto}`), []);
  });

  it('todo TIPO DE MENSAGEM WS está no censo, com classe e motivo', () => {
    const acusados = tiposNaoClassificados(tiposDeMensagemWs(inventario));
    assert.deepEqual(
      acusados, [],
      `frame novo sem classificação: ${acusados.join(', ')}`
    );
    const ruins = CENSO_TIPO_WS
      .filter((e) => ![M_ENTIDADE, M_SEM_ENTIDADE].includes(e.classe) || !e.motivo)
      .map((e) => e.tipo);
    assert.deepEqual(ruins, [], 'entrada de tipo sem classe válida ou sem motivo escrito');
  });

  // ==========================================================================
  // OS DOIS ESTRANGULAMENTOS — a posição deles é o contrato
  // ==========================================================================
  it('o embrulho de `res.json` é montado ANTES da primeira rota', () => {
    const app = lerCodigo('src/app.js');
    // A DECLARAÇÃO PRECISA SER INCONDICIONAL, e não só existir: um `app.use` dentro de um `if`
    // continuaria casando uma busca por substring enquanto a fronteira ficava desligada. Foi o que
    // o controle negativo desta fase mediu na primeira tentativa, e o guarda passou verde.
    const linhaDaPoda = /^[ \t]*app\.use\(pruneResponsePayload\);[ \t]*$/m.exec(app);
    assert.ok(linhaDaPoda, 'o middleware de poda precisa estar montado, incondicionalmente, em app.js');
    const poda = linhaDaPoda.index;

    // A PRIMEIRA saída montada é a rota de health, e depois vêm os `app.use('/api/...')`. Um
    // middleware montado depois de qualquer uma delas não seria atravessado por ela: a cobertura
    // "por construção" depende inteiramente desta ordem, então ela é medida e não prometida.
    const primeiraRota = app.search(/\bapp\.(get|post|put|patch|delete|all|use)\(\s*['"`]\//);
    assert.ok(primeiraRota > 0, 'esperava achar a primeira rota/montagem de app.js');
    assert.ok(
      poda < primeiraRota,
      'o embrulho de `res.json` precisa vir ANTES da primeira rota montada, senão ela não passa por ele'
    );
  });

  it('o embrulho de `ws.send` é a primeira linha de `onConnection`, e todo socket passa por lá', () => {
    const gw = lerCodigo('src/modules/collab/collab.gateway.js');
    const decl = gw.indexOf('function onConnection(');
    assert.ok(decl > 0);
    const corpo = gw.slice(decl, decl + 800);
    const linhaDoEmbrulho = /^[ \t]*installOutboundResourcePrune\(ws\);[ \t]*$/m.exec(corpo);
    assert.ok(linhaDoEmbrulho, 'o embrulho precisa ser instalado, incondicionalmente, dentro de `onConnection`');
    const instala = linhaDoEmbrulho.index;

    // Antes dele não pode haver NADA que escreva no socket: o que rodar antes da substituição
    // escreve no `send` original e escapa da fronteira.
    const antes = corpo.slice(0, instala);
    assert.ok(!/\.send\(/.test(antes), 'nenhum `send` pode acontecer antes da instalação do embrulho');

    // E o socket precisa nascer só aqui. `handleUpgrade` é o único ponto em que um socket de
    // colaboração passa a existir; se aparecer um segundo, ele precisa instalar o embrulho também.
    const upgrades = [...gw.matchAll(/wss\.handleUpgrade\(/g)];
    assert.equal(upgrades.length, 1, 'esperava UM ponto de upgrade; um segundo precisaria instalar o embrulho');
    assert.ok(
      /handleUpgrade\([\s\S]{0,300}onConnection\(/.test(gw),
      'o upgrade precisa entregar o socket a `onConnection`, que é quem instala o embrulho'
    );
  });

  // ==========================================================================
  // OS CONTROLES NEGATIVOS — provados com fixture, não afirmados
  // ==========================================================================
  it('a varredura REPROVA uma ROTA nova não classificada, POST inclusive (provado com fixture)', () => {
    // A FIXTURE É O PONTO CEGO EM PESSOA: um `POST` que devolve uma linha, que é exatamente a
    // forma que o censo anterior não enxergava, ao lado de um `GET` de controle.
    const fixture = 'tests/fixtures/censo-saidas/exemplo-rota-nao-classificada.routes.js';
    const achadas = rotasDeSaida([fixture]);
    assert.deepEqual(
      achadas.map((a) => a.rota),
      ['GET /rota-de-leitura-sem-classificacao', 'POST /rota-de-escrita-sem-classificacao'],
      'a varredura precisa ENXERGAR as duas rotas da fixture; se ela deixar de casar, os outros '
      + 'casos deste arquivo passam verdes sem verificar nada'
    );

    const acusadas = rotasNaoClassificadas(achadas);
    assert.equal(acusadas.length, 2, `esperava DUAS acusações, achei: ${acusadas.join(' | ')}`);
    assert.ok(acusadas.some((a) => a.includes('POST /rota-de-escrita-sem-classificacao')));

    // E a DISCRIMINAÇÃO, sem a qual "acusa" também seria o comportamento de quem acusa tudo.
    assert.deepEqual(rotasNaoClassificadas(rotasDeSaida(arquivosDeRota(inventario))), []);
  });

  it('a varredura REPROVA um EMISSOR novo fora do `res.json` (provado com fixture)', () => {
    const fixture = 'tests/fixtures/censo-saidas/exemplo-emissor-nao-classificado.controller.js';
    const achados = emissoresNaoJson([fixture]);
    assert.equal(achados.size, 1, `a varredura precisa ver o emissor da fixture; viu: ${achados.size}`);
    assert.match([...achados.keys()][0], /res\.send\(/);

    const acusados = naoClassificados(achados, CENSO_EMISSOR);
    assert.ok(
      acusados.some((a) => a.includes('exemplo-emissor-nao-classificado')),
      `o emissor da fixture precisa ser ACUSADO; acusados: ${acusados.join(' | ')}`
    );
    assert.deepEqual(naoClassificados(emissoresNaoJson(inventario), CENSO_EMISSOR), []);
  });

  it('a varredura REPROVA um SÍTIO DE ENVIO e um TIPO DE MENSAGEM novos (provado com fixture)', () => {
    const fixture = 'tests/fixtures/censo-saidas/exemplo-mensagem-nao-classificada.handlers.js';

    const envios = sitiosDeEnvioWs([fixture]);
    assert.equal(envios.size, 1, `a varredura precisa ver a escrita no socket da fixture; viu: ${envios.size}`);
    assert.ok(naoClassificados(envios, CENSO_ENVIO_WS).some((a) => a.includes('exemplo-mensagem-nao-classificada')));

    const tipos = tiposDeMensagemWs([fixture]);
    assert.deepEqual(
      [...tipos.keys()], ['mensagem_sem_classificacao'],
      'a varredura de tipo precisa ENXERGAR o frame da fixture'
    );
    assert.deepEqual(tiposNaoClassificados(tipos), ['mensagem_sem_classificacao']);

    // Discriminação nas duas.
    assert.deepEqual(naoClassificados(sitiosDeEnvioWs(arquivosDeCollab(inventario)), CENSO_ENVIO_WS), []);
    assert.deepEqual(tiposNaoClassificados(tiposDeMensagemWs(inventario)), []);
  });

  it('o inventário ENXERGA arquivo NOVO ainda não rastreado (provado, não afirmado)', () => {
    // CONTROLE DE CONJUNTO, não de classificação: a rota escrita há cinco minutos é a que ninguém
    // classificou, e `git ls-files` sozinho a deixaria fora da varredura até alguém dar `git add`.
    const dir = 'tests/fixtures/censo-saidas';
    const relativo = `${dir}/tmp-nao-rastreada.routes.js`;
    const abs = path.join(RAIZ, relativo);
    fs.writeFileSync(abs, [
      `// Path: ${relativo}`,
      '// Temporário: criado e apagado pelo controle negativo deste censo.',
      "router.patch('/rota-temporaria-sem-classificacao', ctrl.qualquer);",
      '',
    ].join('\n'));

    try {
      const soRastreados = execFileSync('git', ['ls-files', dir], { cwd: RAIZ, encoding: 'utf8' });
      assert.ok(!soRastreados.includes('tmp-nao-rastreada'), 'a fixture temporária não pode estar rastreada');
      assert.ok(
        soRastreados.includes('exemplo-rota-nao-classificada.routes.js'),
        'o pathspec precisa alcançar a fixture rastreada'
      );

      const inv = arquivosDoInventario(dir);
      assert.ok(inv.includes(relativo), 'o inventário precisa enxergar o arquivo NÃO RASTREADO');

      const acusadas = rotasNaoClassificadas(rotasDeSaida(arquivosDeRota(inv.concat(relativo))));
      assert.ok(
        acusadas.some((a) => a.includes('PATCH /rota-temporaria-sem-classificacao')),
        `a rota do arquivo não rastreado precisa ser ACUSADA; acusadas: ${acusadas.join(' | ')}`
      );
    } finally {
      fs.rmSync(abs, { force: true });
    }
  });
});
