// Path: tests/unit/auditoria-censo.test.js
//
// O CENSO DA AUDITORIA: toda rota de ESCRITA tem trilha, ou uma isenção escrita.
//
// A migração 020 fechou catorze buracos de uma vez, e três deles eram da pior
// espécie: `LOGIN`, `LOGOUT` e `ATLAS_DELETE` estavam DECLARADAS no CHECK desde a
// 001_core.sql e a contagem de emissores em `src/` era ZERO para as três. Isso não
// é uma ação faltando — é um filtro que responde "ninguém apagou atlas nenhum" e
// parece uma resposta. O modo de falha que este arquivo existe para impedir é o
// mesmo, na direção do futuro: uma rota de escrita NOVA que nasce sem trilha, e
// nada fica vermelho porque nada estava olhando.
//
// COMO ELE FUNCIONA, em dois níveis (o molde é `tests/unit/papel-global-censo.test.js`):
//
//   A VARREDURA. O inventário vem do VERSIONAMENTO (`git ls-files` sobre `src/`),
//   nunca de uma lista de alvos escrita à mão: "conferir um subconjunto e tratar
//   como o conjunto" é a classe mais repetida de `docs/livro-razao.md`. Toda
//   chamada `router.post/put/patch/delete` de todo `*.routes.js` precisa aparecer
//   no censo. Rota nova não classificada REPROVA, e isso é PROVADO por um caso
//   deste arquivo, que aponta a mesma varredura para uma fixture com uma rota de
//   escrita sem classificação (`tests/fixtures/censo-auditoria/`) e exige que ela
//   seja acusada. Um guarda que afirma sobre si mesmo não é guarda.
//
//   O CENSO. Uma entrada por rota, em exatamente uma de TRÊS classes:
//     - AUDITADA: emite trilha. A entrada nomeia a AÇÃO e o ARQUIVO EMISSOR, e o
//       teste confere que aquele arquivo cita aquela ação — a ligação rota→emissor
//       é o que uma lista de ações sozinha não prende.
//     - ISENTA: não audita, POR DECISÃO, com o motivo escrito. Conteúdo de atlas
//       (o log de operações já É a trilha), evento de altíssima frequência
//       (calibração de foto 360, rotação de token), cosmético sem eixo de acesso.
//     - BURACO: não audita e DEVERIA, reconhecido por escrito e com TETO. A classe
//       existe para que uma lacuna não possa se disfarçar de isenção — que é
//       exatamente como as três ações sem emissor sobreviveram desde a 001.
//
// FRAGILIDADES ACEITAS. (a) O inventário precisa de `git`; se o comando falhar, o
// caso-piso diz isso nessas palavras, porque falha de ambiente lida como regressão
// custa mais do que o guarda economiza. (b) A varredura reconhece rota pelo padrão
// `router.<verbo>(` com o caminho em literal — uma rota montada por variável sai da
// contagem, e a direção do erro é perder um sítio, não inventar um. (c) O censo
// prende a EXISTÊNCIA da trilha, nunca o conteúdo dela: que a linha traga o ator, o
// alvo certo e os detalhes é comportamento, e mora em
// `tests/integration/auditoria-acoes-novas.test.js`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

const AUDITADA = 'auditada';
const ISENTA = 'isenta-por-decisao';
const BURACO = 'buraco-conhecido';

/** Emissores usados por mais de uma entrada, para o censo caber na tela. */
const ATLAS_CTRL = 'src/modules/atlas/atlas.controller.js';
const RA_SVC = 'src/modules/resource-access/resource-access.service.js';
const SHARING_SVC = 'src/modules/sharing/sharing.service.js';
const USERS_SVC = 'src/modules/users/users.service.js';
const ZONES_SVC = 'src/modules/zones/zones.service.js';
const SV360_ADMIN_SVC = 'src/modules/streetview360/sv360.admin.service.js';

/** Motivos de isenção que se repetem, escritos uma vez. */
const CONTEUDO_DE_ATLAS = 'Conteúdo colaborativo de atlas: o LOG DE OPERAÇÕES é a trilha, e ele guarda '
  + 'ator, momento e a mudança inteira. Uma segunda cópia em audit_trail divergiria da primeira.';
const CALIBRACAO_360 = 'Calibração de foto 360: evento de altíssima frequência, a foto já carrega '
  + '`updated_at`, e uma linha por ajuste afogaria a trilha no ruído que menos importa. A auditoria '
  + 'do 360 é no nível do PROJETO (ingestão, exclusão, ocultação), que é onde o acesso se decide.';
const COSMETICO = 'Metadado de apresentação do atlas (nome, descrição, capa): não move nenhum eixo '
  + 'de acesso e a própria linha guarda o valor atual.';

/**
 * @typedef {Object} EntradaDoCenso
 * @property {string} arquivo - Caminho do `*.routes.js`, relativo a `backend/`.
 * @property {string} rota - `METODO caminho`, como a varredura o encontra.
 * @property {AUDITADA|ISENTA|BURACO} classe
 * @property {string} [acao] - A ação de `audit_trail.action` (obrigatória em AUDITADA).
 * @property {string} [emissor] - O arquivo que a emite (obrigatório em AUDITADA).
 * @property {string} [motivo] - Obrigatório em ISENTA e BURACO.
 */

/** @type {EntradaDoCenso[]} */
const CENSO = [
  // ---------------- atlas: ciclo de vida auditado, conteúdo isento --------------
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'POST /', classe: AUDITADA, acao: 'ATLAS_CREATE', emissor: ATLAS_CTRL },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'POST /import', classe: AUDITADA, acao: 'ATLAS_CREATE', emissor: ATLAS_CTRL },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'POST /:atlasId/clone', classe: AUDITADA, acao: 'ATLAS_CREATE', emissor: ATLAS_CTRL },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'DELETE /:atlasId', classe: AUDITADA, acao: 'ATLAS_DELETE', emissor: ATLAS_CTRL },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'POST /:atlasId/restore', classe: AUDITADA, acao: 'ATLAS_RESTORE', emissor: ATLAS_CTRL },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'POST /:atlasId/transfer', classe: AUDITADA, acao: 'ATLAS_TRANSFER', emissor: 'src/modules/atlas/atlas.service.js' },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'POST /:atlasId/resources', classe: AUDITADA, acao: 'SHARING_CHANGE', emissor: RA_SVC },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'DELETE /:atlasId/resources/:type/:id', classe: AUDITADA, acao: 'SHARING_CHANGE', emissor: RA_SVC },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'PUT /:atlasId', classe: ISENTA, motivo: COSMETICO },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'PUT /:atlasId/cover', classe: ISENTA, motivo: COSMETICO },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'DELETE /:atlasId/cover', classe: ISENTA, motivo: COSMETICO },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'POST /:atlasId/maps/:mapId/duplicate', classe: ISENTA, motivo: CONTEUDO_DE_ATLAS },
  {
    arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'PATCH /:atlasId/settings', classe: BURACO,
    motivo: 'O overlay de disponibilidade do atlas (3D, 360, camadas de dados) DESLIGA superfícies '
      + 'inteiras para todos os membros, então é decisão de acesso e deveria deixar linha. Fica '
      + 'nomeada aqui em vez de coberta porque a fase de auditoria não a listou, e alargar escopo '
      + 'sem decisão é como uma lacuna vira duas.',
  },

  // ---------------- auth ----------------------------------------------------
  { arquivo: 'src/modules/auth/auth.routes.js', rota: 'POST /login', classe: AUDITADA, acao: 'LOGIN', emissor: 'src/modules/auth/auth.controller.js' },
  { arquivo: 'src/modules/auth/auth.routes.js', rota: 'POST /logout', classe: AUDITADA, acao: 'LOGOUT', emissor: 'src/modules/auth/auth.controller.js' },
  { arquivo: 'src/modules/auth/auth.routes.js', rota: 'POST /register', classe: AUDITADA, acao: 'USER_CREATE', emissor: 'src/modules/auth/auth.service.js' },
  {
    arquivo: 'src/modules/auth/auth.routes.js', rota: 'POST /refresh', classe: ISENTA,
    motivo: 'Rotação de refresh token: altíssima frequência e nenhuma decisão humana. Auditá-la é '
      + 'auditar o keep-alive, e afogaria as duas linhas por sessão que LOGIN/LOGOUT produzem.',
  },
  {
    arquivo: 'src/modules/auth/auth.routes.js', rota: 'POST /verify-email', classe: ISENTA,
    motivo: 'Confirmação de e-mail pelo próprio titular, com token de uso único: não há ator '
      + 'administrativo, e o efeito (`email_verified`) é uma coluna da própria conta.',
  },
  {
    arquivo: 'src/modules/auth/auth.routes.js', rota: 'POST /resend-verification', classe: ISENTA,
    motivo: 'Reenvio do e-mail de confirmação: não muda estado de autorização nenhum, e é rota '
      + 'com limitador próprio justamente por poder ser repetida à vontade.',
  },

  // ---------------- catálogo (a fábrica serve as QUATRO tabelas) --------------
  { arquivo: 'src/modules/catalog/catalog.routes.js', rota: 'POST /', classe: AUDITADA, acao: 'CATALOG_CREATE', emissor: 'src/modules/catalog/catalog.controller.js' },
  { arquivo: 'src/modules/catalog/catalog.routes.js', rota: 'PUT /:id', classe: AUDITADA, acao: 'CATALOG_UPDATE', emissor: 'src/modules/catalog/catalog.controller.js' },
  { arquivo: 'src/modules/catalog/catalog.routes.js', rota: 'DELETE /:id', classe: AUDITADA, acao: 'CATALOG_DELETE', emissor: 'src/modules/catalog/catalog.controller.js' },

  // ---------------- config: o documento de boot -------------------------------
  { arquivo: 'src/modules/config/config.routes.js', rota: 'PUT /admin', classe: AUDITADA, acao: 'CONFIG_UPDATE', emissor: 'src/modules/config/config.service.js' },
  { arquivo: 'src/modules/config/config.routes.js', rota: 'DELETE /admin', classe: AUDITADA, acao: 'CONFIG_CLEAR', emissor: 'src/modules/config/config.service.js' },

  // ---------------- debug -----------------------------------------------------
  {
    arquivo: 'src/modules/debug/debug.routes.js', rota: 'DELETE /trace', classe: ISENTA,
    motivo: 'O anel do SyncLedger, montado só com o tracer ligado e NUNCA em produção (conjunção '
      + 'no ponto de montagem em app.js). Apagar diagnóstico volátil de test/dev não é evento de '
      + 'acesso, e a rota inteira não existe no ambiente onde a trilha é lida.',
  },

  // ---------------- conteúdo de atlas ----------------------------------------
  { arquivo: 'src/modules/images/images.routes.js', rota: 'POST /', classe: ISENTA, motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/images/images.routes.js', rota: 'POST /bulk', classe: ISENTA, motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/images/images.routes.js', rota: 'DELETE /:imageId', classe: ISENTA, motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/maps/maps.routes.js', rota: 'POST /:mapId/merge', classe: ISENTA, motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/sync/sync.routes.js', rota: 'POST /', classe: ISENTA, motivo: CONTEUDO_DE_ATLAS },
  {
    arquivo: 'src/modules/sync/sync.routes.js', rota: 'POST /admin/cleanup', classe: BURACO,
    motivo: 'Expurgo administrativo de operações antigas: apaga justamente o log que serve de '
      + 'trilha para todo o conteúdo de atlas, e não deixa nada dizendo quem apagou o quê. É a '
      + 'lacuna mais incômoda desta lista, porque destrói a trilha alternativa que isenta cinco '
      + 'outras rotas aqui.',
  },

  // ---------------- organizações e postos -------------------------------------
  { arquivo: 'src/modules/organizations/organizations.routes.js', rota: 'POST /', classe: AUDITADA, acao: 'ORG_CREATE', emissor: 'src/modules/organizations/organizations.controller.js' },
  { arquivo: 'src/modules/organizations/organizations.routes.js', rota: 'PUT /:id', classe: AUDITADA, acao: 'ORG_UPDATE', emissor: 'src/modules/organizations/organizations.controller.js' },
  { arquivo: 'src/modules/organizations/organizations.routes.js', rota: 'DELETE /:id', classe: AUDITADA, acao: 'ORG_DELETE', emissor: 'src/modules/organizations/organizations.controller.js' },
  {
    arquivo: 'src/modules/ranks/ranks.routes.js', rota: 'POST /', classe: BURACO,
    motivo: 'CRUD de postos e graduações, sem trilha nenhuma, em assimetria declarada com o de '
      + 'organizações, que audita as três. Não move eixo de acesso, mas é tabela de domínio '
      + 'administrada por admin, e a assimetria é acidente histórico, não decisão.',
  },
  { arquivo: 'src/modules/ranks/ranks.routes.js', rota: 'PUT /:id', classe: BURACO, motivo: 'Idem POST /: CRUD de postos sem trilha, assimétrico com organizações, por acidente histórico.' },
  { arquivo: 'src/modules/ranks/ranks.routes.js', rota: 'DELETE /:id', classe: BURACO, motivo: 'Idem POST /: CRUD de postos sem trilha, assimétrico com organizações, por acidente histórico.' },

  // ---------------- acesso a recurso privado ----------------------------------
  { arquivo: 'src/modules/resource-access/resource-access.routes.js', rota: 'PATCH /:type/:id/visibility', classe: AUDITADA, acao: 'SHARING_CHANGE', emissor: RA_SVC },
  { arquivo: 'src/modules/resource-access/resource-access.routes.js', rota: 'POST /:type/:id/grants', classe: AUDITADA, acao: 'PERMISSION_GRANT', emissor: RA_SVC },
  { arquivo: 'src/modules/resource-access/resource-access.routes.js', rota: 'DELETE /grants/:grantId', classe: AUDITADA, acao: 'PERMISSION_REVOKE', emissor: RA_SVC },

  // ---------------- compartilhamento de atlas ---------------------------------
  { arquivo: 'src/modules/sharing/sharing.routes.js', rota: 'POST /public', classe: AUDITADA, acao: 'SHARING_CHANGE', emissor: SHARING_SVC },
  { arquivo: 'src/modules/sharing/sharing.routes.js', rota: 'DELETE /public', classe: AUDITADA, acao: 'SHARING_CHANGE', emissor: SHARING_SVC },
  { arquivo: 'src/modules/sharing/sharing.routes.js', rota: 'POST /users', classe: AUDITADA, acao: 'PERMISSION_GRANT', emissor: SHARING_SVC },
  { arquivo: 'src/modules/sharing/sharing.routes.js', rota: 'PUT /users/:userId', classe: AUDITADA, acao: 'SHARING_CHANGE', emissor: SHARING_SVC },
  { arquivo: 'src/modules/sharing/sharing.routes.js', rota: 'DELETE /users/:userId', classe: AUDITADA, acao: 'PERMISSION_REVOKE', emissor: SHARING_SVC },

  // ---------------- 360: projeto audita, foto não -----------------------------
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'POST /admin/projects/upload', classe: AUDITADA, acao: 'SV360_INGEST', emissor: 'src/modules/streetview360/sv360.admin.controller.js' },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PATCH /admin/projects/:slug/status', classe: AUDITADA, acao: 'SV360_STATUS_CHANGE', emissor: SV360_ADMIN_SVC },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'DELETE /admin/projects/:slug', classe: AUDITADA, acao: 'SV360_DELETE', emissor: SV360_ADMIN_SVC },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'POST /photos/batch-calibration', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PUT /photos/:uuid/calibration', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PUT /photos/:uuid/rotation-x', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PUT /photos/:uuid/rotation-z', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PUT /photos/:uuid/reviewed', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PUT /photos/:uuid/targets/:targetId/visibility', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'DELETE /photos/:uuid/targets/:targetId', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'POST /photos/:uuid/targets', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'DELETE /photos/:uuid', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PUT /projects/:slug/batch-calibration', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'POST /projects/:slug/reset-reviewed', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PUT /runs/:runId/batch-calibration', classe: ISENTA, motivo: CALIBRACAO_360 },

  // ---------------- usuários --------------------------------------------------
  { arquivo: 'src/modules/users/users.routes.js', rota: 'POST /', classe: AUDITADA, acao: 'USER_CREATE', emissor: USERS_SVC },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'PUT /:userId', classe: AUDITADA, acao: 'USER_UPDATE', emissor: USERS_SVC },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'POST /:userId/reset-password', classe: AUDITADA, acao: 'PASSWORD_RESET', emissor: USERS_SVC },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'DELETE /:userId', classe: AUDITADA, acao: 'USER_DELETE', emissor: USERS_SVC },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'POST /:userId/reactivate', classe: AUDITADA, acao: 'USER_REACTIVATE', emissor: USERS_SVC },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'POST /:userId/api-key/rotate', classe: AUDITADA, acao: 'API_KEY_ROTATE', emissor: USERS_SVC },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'POST /me/api-key/rotate', classe: AUDITADA, acao: 'API_KEY_ROTATE', emissor: USERS_SVC },
  {
    arquivo: 'src/modules/users/users.routes.js', rota: 'PUT /me', classe: BURACO,
    motivo: 'Auto-edição de perfil sem trilha, enquanto a edição pelo administrador emite '
      + 'USER_UPDATE. A assimetria é conhecida e fica nomeada: quem investiga uma conta vê o que o '
      + 'admin fez com ela e não o que o titular fez consigo.',
  },
  {
    arquivo: 'src/modules/users/users.routes.js', rota: 'PUT /me/password', classe: BURACO,
    motivo: 'Troca de senha pelo próprio titular sem trilha, enquanto o reset por administrador '
      + 'emite PASSWORD_RESET. Mesma assimetria da edição de perfil, e mais visível porque senha é '
      + 'o único fator de autenticação da casa.',
  },

  // ---------------- zonas geográficas (schema ng) -----------------------------
  { arquivo: 'src/modules/zones/zones.routes.js', rota: 'POST /', classe: AUDITADA, acao: 'ZONE_CREATE', emissor: ZONES_SVC },
  { arquivo: 'src/modules/zones/zones.routes.js', rota: 'PUT /:id', classe: AUDITADA, acao: 'ZONE_UPDATE', emissor: ZONES_SVC },
  { arquivo: 'src/modules/zones/zones.routes.js', rota: 'DELETE /:id', classe: AUDITADA, acao: 'ZONE_DELETE', emissor: ZONES_SVC },
  { arquivo: 'src/modules/zones/zones.routes.js', rota: 'PUT /:id/permissions', classe: AUDITADA, acao: 'PERMISSION_GRANT', emissor: ZONES_SVC },
];

/**
 * Os `target_type` DECLARADOS e sem nenhum emissor. São QUATRO, e os dois últimos
 * são medições, não heranças:
 *
 *   - `MODEL` e `GROUP` vêm da 001_core.sql e nunca tiveram escritor. A 020 os
 *     manteve porque removê-los seria DDL destrutiva sem ganho.
 *   - `SYSTEM` TINHA um escritor e PERDEU: era onde `setResourceVisibility`
 *     depositava o alvo que não cabia nas colunas (`target_type` sem valor para
 *     recurso, `target_id` UUID contra um slug). A 020 devolveu o alvo às colunas e,
 *     com isso, 'SYSTEM' voltou a significar sistema — e ficou sem ninguém que o
 *     escreva.
 *   - `STREETVIEW_MARKER` também TINHA escritor e PERDEU, e por um motivo
 *     diferente dos outros três: o único emissor era o mapa
 *     `AUDIT_TARGET_TYPE_BY_TABLE` de `catalog.tables.js`, e a migração 021 apagou
 *     a TABELA que aquela entrada nomeava. O valor sobrevive no CHECK porque
 *     tirá-lo seria DDL destrutiva sem ganho (o mesmo argumento de `MODEL`/`GROUP`)
 *     e porque linhas de trilha já gravadas podem carregá-lo.
 *
 * Está certo assim, e fica REGISTRADO aqui: um vocabulário reservado é diferente de
 * um vocabulário esquecido, e a única forma de manter a distinção é escrevê-la.
 */
const ALVOS_SEM_EMISSOR = ['GROUP', 'MODEL', 'STREETVIEW_MARKER', 'SYSTEM'];

// ============================================================================
// A VARREDURA
// ============================================================================

/** Remove comentário de bloco e de linha (o `\r` do CRLF entra na normalização). */
function semComentarios(src) {
  const normalizado = src.replace(/\r\n?/g, '\n');
  const semBloco = normalizado.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return semBloco.split('\n').map((linha) => linha.replace(/\/\/.*/, '')).join('\n');
}

function arquivosVersionados() {
  return execFileSync('git', ['ls-files', 'src'], { cwd: RAIZ, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.js'));
}

/**
 * Toda rota de ESCRITA dos arquivos dados, na forma `{ arquivo, rota }`.
 *
 * O caminho é lido do literal que segue o verbo, e o `\s*` cobre as declarações
 * multi-linha (a metade das rotas do 360 e do acesso a recurso é assim).
 * @param {string[]} arquivos - Caminhos relativos a `backend/`.
 * @returns {{arquivo: string, rota: string, linha: number}[]}
 */
function rotasDeEscrita(arquivos) {
  const achadas = [];
  for (const arquivo of arquivos) {
    const src = semComentarios(fs.readFileSync(path.join(RAIZ, arquivo), 'utf8'));
    const re = /router\.(post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2/g;
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

/** As rotas não classificadas, no formato de mensagem de erro. */
function naoClassificadas(achadas) {
  return achadas
    .filter((a) => !CENSO.some((e) => e.arquivo === a.arquivo && e.rota === a.rota))
    .map((a) => `${a.arquivo}:${a.linha} ${a.rota}`);
}

const arquivosDeRota = () => arquivosVersionados().filter((a) => a.endsWith('.routes.js'));

/** As ações declaradas no CHECK da 020, lidas do .sql (nunca de uma terceira cópia). */
function acoesDoCheck() {
  const sql = fs.readFileSync(
    path.join(RAIZ, 'src/database/migrations/020_auditoria_alvo_e_acoes.sql'), 'utf8'
  );
  const i = sql.indexOf('ADD CONSTRAINT audit_trail_action_check');
  assert.notEqual(i, -1, 'o CHECK de `action` sumiu da migração 020');
  const bloco = sql.slice(i, sql.indexOf('));', i));
  const semComentario = bloco.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  return [...semComentario.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]);
}

/** Os `target_type` declarados no CHECK da 020. */
function alvosDoCheck() {
  const sql = fs.readFileSync(
    path.join(RAIZ, 'src/database/migrations/020_auditoria_alvo_e_acoes.sql'), 'utf8'
  );
  const i = sql.indexOf('ADD CONSTRAINT audit_trail_target_type_check');
  assert.notEqual(i, -1, 'o CHECK de `target_type` sumiu da migração 020');
  const bloco = sql.slice(i, sql.indexOf('));', i));
  const semComentario = bloco.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  return [...semComentario.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]);
}

/** O CÓDIGO (sem comentário) de todo arquivo versionado de `src/`, por caminho. */
function fontesDeSrc() {
  return new Map(arquivosVersionados().map((a) => [
    a, semComentarios(fs.readFileSync(path.join(RAIZ, a), 'utf8')),
  ]));
}

describe('Censo da auditoria (fase F7): rota de escrita tem trilha, ou isenção escrita', () => {
  it('piso: o inventário vem do git e alcança todos os módulos de rota', () => {
    let arquivos;
    try {
      arquivos = arquivosDeRota();
    } catch (err) {
      assert.fail(
        `o inventário deste censo vem de \`git ls-files\` e o comando FALHOU (${err.message}). `
        + 'Isto é falha de ambiente, não regressão de código: rode dentro do repositório.'
      );
    }
    assert.ok(arquivos.length >= 15, `esperava >= 15 arquivos de rota, achei ${arquivos.length}`);
    assert.ok(arquivos.includes('src/modules/atlas/atlas.routes.js'), 'a varredura precisa alcançar o atlas');
    assert.ok(arquivos.includes('src/modules/catalog/catalog.routes.js'), 'e o catálogo');

    const achadas = rotasDeEscrita(arquivos);
    assert.ok(achadas.length >= 60, `esperava >= 60 rotas de escrita, achei ${achadas.length}`);
  });

  it('toda rota de escrita está no censo, com classe e (quando audita) ação e emissor', () => {
    const achadas = rotasDeEscrita(arquivosDeRota());
    assert.ok(achadas.length >= 60, 'guarda: censo comparado contra varredura vazia passaria verde');

    assert.deepEqual(
      naoClassificadas(achadas), [],
      'rota de ESCRITA fora do censo da auditoria. Classifique-a em '
      + `'${AUDITADA}' (com \`acao\` e \`emissor\`), '${ISENTA}' (com motivo escrito) `
      + `ou '${BURACO}' (lacuna reconhecida, com motivo e dentro do teto).`
    );
  });

  it('toda entrada do censo aponta para uma rota que EXISTE (apagar rota é tão vermelho quanto criar)', () => {
    const achadas = rotasDeEscrita(arquivosDeRota());
    assert.ok(achadas.length >= 60);

    const orfas = CENSO
      .filter((e) => !achadas.some((a) => a.arquivo === e.arquivo && a.rota === e.rota))
      .map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.deepEqual(
      orfas, [],
      'entrada de censo sem rota correspondente: ou a rota foi renomeada/removida, ou o caminho '
      + 'está escrito diferente do literal. Um censo que descreve rotas inexistentes deixa de '
      + 'descrever as que existem.'
    );

    // Duplicata silenciosa: duas entradas para a mesma rota fariam a contagem por
    // classe mentir sem que nada mais reclamasse.
    const chaves = CENSO.map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.equal(new Set(chaves).size, chaves.length, 'entrada duplicada no censo');
  });

  it('cada rota AUDITADA nomeia uma ação do CHECK e um emissor que realmente a cita', () => {
    const auditadas = CENSO.filter((e) => e.classe === AUDITADA);
    assert.ok(auditadas.length >= 30, `esperava >= 30 rotas auditadas, achei ${auditadas.length}`);

    const acoes = new Set(acoesDoCheck());
    assert.ok(acoes.size >= 30, `o CHECK da 020 devolveu só ${acoes.size} ações`);

    const fontes = fontesDeSrc();
    const quebradas = auditadas.flatMap((e) => {
      const problemas = [];
      if (!e.acao || !acoes.has(e.acao)) {
        problemas.push(`${e.arquivo} :: ${e.rota} declara a ação '${e.acao}', que não está no CHECK da 020`);
      }
      const emissor = fontes.get(e.emissor);
      if (!emissor) {
        problemas.push(`${e.arquivo} :: ${e.rota} aponta para o emissor '${e.emissor}', que não existe em src/`);
      } else if (!emissor.includes(`'${e.acao}'`)) {
        // A LIGAÇÃO ROTA -> EMISSOR é o que uma lista de ações sozinha não prende:
        // uma ação com emissor em ALGUM lugar do sistema não diz que ESTA rota
        // escreve trilha. O texto é o CÓDIGO, sem comentário, senão uma menção em
        // prosa satisfaria o guarda.
        problemas.push(`${e.arquivo} :: ${e.rota} declara '${e.acao}' em ${e.emissor}, que não a emite`);
      }
      return problemas;
    });
    assert.deepEqual(quebradas, [], 'entrada AUDITADA sem ação válida ou sem emissor que a escreva');
  });

  it('toda isenção e todo buraco têm motivo escrito, e os buracos não crescem em silêncio', () => {
    const isentas = CENSO.filter((e) => e.classe === ISENTA);
    const buracos = CENSO.filter((e) => e.classe === BURACO);
    assert.ok(isentas.length >= 15, `esperava >= 15 isenções, achei ${isentas.length}`);
    assert.ok(buracos.length >= 1, 'guarda: a classe BURACO precisa estar em uso, senão ela não discrimina nada');

    const semMotivo = [...isentas, ...buracos]
      .filter((e) => !e.motivo || e.motivo.length < 80)
      .map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.deepEqual(
      semMotivo, [],
      'isenção sem motivo escrito é a mesma coisa que rota sem trilha, só que com uma linha a mais'
    );

    // O TETO. Sem ele, a saída fácil para uma rota nova sem trilha seria classificá-la
    // como BURACO e seguir em frente — que é exatamente como LOGIN, LOGOUT e
    // ATLAS_DELETE sobreviveram sem emissor desde a 001_core.sql.
    assert.ok(
      buracos.length <= 7,
      `os buracos conhecidos são 7 e não podem crescer sem decisão; achei ${buracos.length}`
    );

    // Nenhuma entrada pode ter classe fora das três, nem ação declarada sem auditar.
    const malFormadas = CENSO
      .filter((e) => ![AUDITADA, ISENTA, BURACO].includes(e.classe)
        || (e.classe !== AUDITADA && (e.acao || e.emissor)))
      .map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.deepEqual(malFormadas, [], 'entrada com classe inválida, ou com ação declarada sem auditar');
  });

  it('toda ação declarada no CHECK tem pelo menos UM emissor em src/', () => {
    // ESTE É O CASO QUE A 001 NÃO TINHA. `LOGIN`, `LOGOUT` e `ATLAS_DELETE` ficaram
    // declaradas e sem emissor por toda a vida do projeto, e o sintoma não é erro: é
    // um filtro que responde lista vazia e parece resposta. A varredura é
    // independente do censo de rotas de propósito — ela pergunta pelo outro lado da
    // ponte (a ação existe no vocabulário, alguém a escreve?).
    const acoes = acoesDoCheck();
    assert.ok(acoes.length >= 30, `esperava >= 30 ações no CHECK, achei ${acoes.length}`);
    assert.equal(new Set(acoes).size, acoes.length, 'ação duplicada no CHECK da 020');

    const fontes = [...fontesDeSrc().values()];
    assert.ok(fontes.length >= 100, `esperava >= 100 fontes em src/, achei ${fontes.length}`);

    const semEmissor = acoes.filter((a) => !fontes.some((texto) => texto.includes(`'${a}'`)));
    assert.deepEqual(
      semEmissor, [],
      'ação declarada no CHECK e sem nenhum emissor: quem filtrar a trilha por ela recebe lista '
      + 'vazia e conclui que o evento nunca aconteceu'
    );
  });

  it('todo `target_type` do CHECK tem emissor, exceto os quatro declarados sem escritor', () => {
    const alvos = alvosDoCheck();
    assert.ok(alvos.length >= 14, `esperava >= 14 tipos de alvo, achei ${alvos.length}`);

    const fontes = [...fontesDeSrc().values()];
    const semEmissor = alvos.filter((a) => !fontes.some((texto) => texto.includes(`'${a}'`)));
    assert.deepEqual(
      semEmissor.sort(), ALVOS_SEM_EMISSOR,
      'a lista de alvos sem emissor mudou. `MODEL`, `GROUP`, `STREETVIEW_MARKER` e `SYSTEM` estão '
      + 'declarados e sem escritor por razões escritas ao lado da constante; qualquer OUTRO tipo '
      + 'sem emissor é vocabulário que ninguém escreve, e um dos quatro que ganhe emissor precisa '
      + 'sair da lista'
    );
  });

  // ---------------------------------------------------------------------------
  // O CONTROLE NEGATIVO
  // ---------------------------------------------------------------------------
  it('a varredura REPROVA uma rota de escrita não classificada (provado, não afirmado)', () => {
    // A MESMA FUNÇÃO usada nos casos acima, apontada para uma fixture que declara uma
    // rota de escrita e não está no censo. Sem isto, "o censo pega rota nova" seria
    // uma afirmação do guarda sobre o guarda — e um censo cuja varredura não casasse
    // mais nada (regex quebrada, `git` mudando de saída) passaria os outros casos
    // verdes, comparando vazio com vazio.
    const fixture = 'tests/fixtures/censo-auditoria/exemplo-nao-classificado.routes.js';
    const achadas = rotasDeEscrita([fixture]);
    assert.deepEqual(
      achadas.map((a) => a.rota), ['POST /rota-de-escrita-sem-trilha'],
      'a varredura precisa ENXERGAR a rota da fixture; se ela deixar de casar, os outros casos '
      + 'deste arquivo passam verdes sem verificar nada'
    );

    const acusadas = naoClassificadas(achadas);
    assert.equal(acusadas.length, 1, 'a rota da fixture precisa ser ACUSADA como não classificada');
    assert.match(acusadas[0], /POST \/rota-de-escrita-sem-trilha/);

    // E a discriminação: a MESMA função, sobre as rotas REAIS, não acusa ninguém.
    // Um par, e não duas afirmações soltas: sem o lado positivo, "acusa" também
    // seria o comportamento de uma função que acusa tudo.
    assert.deepEqual(naoClassificadas(rotasDeEscrita(arquivosDeRota())), []);
  });
});
